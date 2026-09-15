import { Injectable, Logger, NotFoundException, ForbiddenException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { hostname } from 'os';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { MqttService } from './mqtt.service';
import { DeskPetBus } from './deskpet.bus';
import { PetReaction, DeskPetEventType, deskpetTopic } from './deskpet.taxonomy';
import {
  DetectionBroadcast,
  mapDetectionToReaction,
  mapComfortToReaction,
  mapAdviceToReaction,
  mapCommandToReaction,
} from './deskpet.reaction';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import type { RegisterDeviceDto, UpdateDeviceDto } from './dto/deskpet.dto';

export interface DeskPetDeviceView {
  id: string;
  deviceId: string;
  name: string;
  studentId: string;
  type: string;
  topicPrefix: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface DeskPetFeed {
  studentId: string;
  connected: boolean;
  mqtt: { connected: boolean; mode: 'remote' | 'local'; url: string | null; clientId?: string | null };
  reaction: PetReaction | null;
  type: DeskPetEventType | null;
}

export interface DeskPetEventView {
  id: string;
  studentId: string;
  type: string;
  reaction: PetReaction;
  source: string | null;
  createdAt: string;
}

/**
 * 桌宠核心服务：
 * - 设备注册 / 查询（DeskPetDevice）
 * - 把检测 / 安抚 / 建议 / 硬件指令映射为桌宠反应，统一分发：
 *   ① 发布到 MQTT（按 channel + 聚合 feed + retained state 多主题）② 经总线驱动 WS 网关广播 ③ 记录 latest 快照 ④ 持久化（detection 按 mood 变化节流）
 * - 阶段八（真实 MQTT 跨进程联动）：
 *   · 每个实例拥有唯一 instanceId，反应信封带 origin 字段；
 *   · onModuleInit 订阅 `deskpet/+/feed`（跨实例反应同步）、`deskpet/+/cmd_up`（真实硬件上行指令）、`deskpet/+/hb`（硬件心跳）；
 *   · 来自「其他实例」的 feed 消息按 origin 去重后驱动本地 WS 总线，实现跨进程转发；
 *   · 来自真实硬件的 cmd_up 经 Redis 分布式锁去重处理，避免多实例重复持久化；
 *   · handleCommand 额外下行 `deskpet/{studentId}/cmd_down` 主题，真实设备可订阅执行动作。
 */
@Injectable()
export class DeskPetService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeskPetService.name);
  /** 实例唯一标识，用于跨进程消息去重（避免自己的回环被重复处理） */
  readonly instanceId: string;
  private latest = new Map<string, { reaction: PetReaction; type: DeskPetEventType }>();
  private lastPersistMood = new Map<string, string>();
  private offFeed?: () => void;
  private offCmdUp?: () => void;
  private offHb?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly mqtt: MqttService,
    private readonly bus: DeskPetBus,
    private readonly redis?: RedisService,
  ) {
    this.instanceId =
      process.env.INSTANCE_ID || `${hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------------- 跨进程 MQTT 订阅（阶段八） ----------------

  onModuleInit(): void {
    const prefix = this.topicPrefix();
    // 跨实例反应同步：其他实例产生的反应经此到达本实例并转发到本地 WS
    this.offFeed = this.mqtt.subscribe(`${prefix}/+/feed`, (p) => this.onRemoteFeed(p));
    // 真实硬件上行：设备主动下发的指令
    this.offCmdUp = this.mqtt.subscribe(`${prefix}/+/cmd_up`, (p) => this.onDeviceCommand(p));
    // 真实硬件心跳：刷新设备 lastSeenAt
    this.offHb = this.mqtt.subscribe(`${prefix}/+/hb`, (p) => this.onDeviceHeartbeat(p));
    this.logger.log(`桌宠跨进程订阅已注册（instanceId=${this.instanceId}）`);
  }

  onModuleDestroy(): void {
    this.offFeed?.();
    this.offCmdUp?.();
    this.offHb?.();
  }

  /** 来自「其他实例」的反应包：去重后驱动本地 WS 总线（不重复持久化，源头已持久化） */
  private onRemoteFeed(p: any): void {
    if (!p || !p.studentId) return;
    if (p.origin && p.origin === this.instanceId) return; // 自己的回环，跳过
    this.bus.emitReaction({ studentId: p.studentId, type: p.type, reaction: p.reaction, ts: p.ts });
    this.latest.set(p.studentId, { reaction: p.reaction, type: p.type });
  }

  /** 来自真实硬件的指令：用 Redis 分布式锁去重，仅一个实例处理，避免重复持久化 */
  private async onDeviceCommand(p: any): Promise<void> {
    if (!p || !p.studentId || !p.action) return;
    const lockKey = `deskpet:cmd:${p.studentId}:${p.action}:${p.nonce || p.ts || 'once'}`;
    const acquired = this.redis ? await this.redis.tryLock(lockKey, 5) : true;
    if (!acquired) return; // 另一实例已处理
    await this.handleCommand(p.studentId, p.action, p.deviceId || 'hardware');
  }

  /** 真实硬件心跳：更新设备最后在线时间 */
  private async onDeviceHeartbeat(p: any): Promise<void> {
    if (!p || !p.studentId || !p.deviceId) return;
    try {
      await this.prisma.deskPetDevice.updateMany({
        where: { studentId: p.studentId, deviceId: p.deviceId },
        data: { lastSeenAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(`桌宠设备心跳更新失败：${(e as Error).message}`);
    }
  }

  private isRemote(): boolean {
    return this.mqtt.status().mode === 'remote';
  }

  private topicPrefix(): string {
    return this.config.get<string>('mqtt.topicPrefix') || 'deskpet';
  }

  // ---------------- 设备 ----------------

  async registerDevice(dto: RegisterDeviceDto): Promise<DeskPetDeviceView> {
    const base = {
      deviceId: dto.deviceId,
      studentId: dto.studentId,
      name: dto.name || `桌宠-${dto.deviceId}`,
      type: (dto.type || 'VIRTUAL') as any,
      topicPrefix: dto.topicPrefix || this.topicPrefix(),
      isActive: true,
      lastSeenAt: new Date(),
    };
    const dev = await this.prisma.deskPetDevice.upsert({
      where: { deviceId: dto.deviceId },
      update: base,
      create: base,
    });
    return this.toDeviceView(dev);
  }

  async listDevices(studentId?: string, includeInactive = false): Promise<DeskPetDeviceView[]> {
    const where: any = {};
    if (studentId) where.studentId = studentId;
    if (!includeInactive) where.isActive = true;
    const rows = await this.prisma.deskPetDevice.findMany({ where, orderBy: { createdAt: 'desc' } });
    return rows.map((r: any) => this.toDeviceView(r));
  }

  async getDevice(id: string): Promise<DeskPetDeviceView> {
    const d = await this.prisma.deskPetDevice.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('设备不存在');
    return this.toDeviceView(d);
  }

  async updateDevice(id: string, dto: UpdateDeviceDto): Promise<DeskPetDeviceView> {
    const exists = await this.prisma.deskPetDevice.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('设备不存在');
    const updated = await this.prisma.deskPetDevice.update({
      where: { id },
      data: { ...(dto as any), lastSeenAt: new Date() },
    });
    return this.toDeviceView(updated);
  }

  async removeDevice(id: string): Promise<{ ok: boolean }> {
    const exists = await this.prisma.deskPetDevice.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('设备不存在');
    await this.prisma.deskPetDevice.delete({ where: { id } });
    return { ok: true };
  }

  // ---------------- 事件入口 ----------------

  handleDetection(studentId: string, broadcast: DetectionBroadcast) {
    const reaction = mapDetectionToReaction(broadcast);
    const type: DeskPetEventType = broadcast.risk ? 'risk' : 'detection';
    return this.dispatch(studentId, type, reaction, 'detection');
  }

  handleComfort(studentId: string, payload: { message?: string } = {}) {
    const reaction = mapComfortToReaction(payload);
    return this.dispatch(studentId, 'comfort', reaction, 'chat');
  }

  /** 聊天进行中：以轻柔方式陪伴，不重复触发强提醒。 */
  handleChat(studentId: string, payload: { content?: string } = {}) {
    const reaction: PetReaction = {
      mood: 'celebrate',
      animation: 'cheer',
      message: payload.content ? '星宝在听你说～' : null,
      intensity: 40,
      ts: new Date().toISOString(),
    };
    return this.dispatch(studentId, 'comfort', reaction, 'chat');
  }

  handleAdvice(studentId: string, payload: { severity?: string } = {}) {
    const reaction = mapAdviceToReaction(payload.severity || 'LOW');
    return this.dispatch(studentId, 'advice', reaction, 'advice');
  }

  handleCommand(studentId: string, action: string, deviceId?: string) {
    void this.audit.log({
      userId: studentId,
      action: 'deskpet.command',
      resource: 'DeskPetDevice',
      detail: { studentId, action, deviceId },
    });
    const reaction = mapCommandToReaction(action);
    // 真实硬件下行：若连接了真实 broker，向设备专属主题下发指令（硬件可订阅执行动作）
    if (this.isRemote()) {
      const prefix = this.topicPrefix();
      this.mqtt.publish(
        deskpetTopic(prefix, studentId, 'cmd_down'),
        { studentId, action, deviceId, ts: new Date().toISOString(), origin: this.instanceId },
      );
    }
    return this.dispatch(studentId, 'command', reaction, deviceId || 'hardware');
  }

  // ---------------- 统一分发 ----------------

  private async dispatch(
    studentId: string,
    type: DeskPetEventType,
    reaction: PetReaction,
    source: string,
  ) {
    const prefix = this.topicPrefix();
    const channel = type === 'risk' ? 'risk' : type;
    const topic = deskpetTopic(prefix, studentId, channel);
    // 信封带 origin，供跨实例消费方去重（避免自己的回环被重复处理）
    const envelope = { studentId, type, reaction, ts: reaction.ts, origin: this.instanceId };

    // ① MQTT 发布：精确 channel + 聚合 feed 主题（便于硬件一次性订阅）
    this.mqtt.publish(topic, envelope);
    this.mqtt.publish(deskpetTopic(prefix, studentId, 'feed'), envelope);
    // 远程模式下，额外发布 retained 状态快照，使新接入的设备/实例立即拿到最新状态
    if (this.isRemote()) {
      this.mqtt.publish(deskpetTopic(prefix, studentId, 'state'), envelope, { retain: true });
    }

    // ② 进程内总线（驱动 WS 网关广播，本地客户端即时收到）
    this.bus.emitReaction({ studentId, type, reaction, ts: reaction.ts });

    // ③ latest 快照
    this.latest.set(studentId, { reaction, type });

    // ④ 持久化（节流：risk/comfort/advice/command 必存；detection 仅在 mood 变化时存）
    const persist = type !== 'detection' || this.lastPersistMood.get(studentId) !== reaction.mood;
    if (persist) {
      this.lastPersistMood.set(studentId, reaction.mood);
      try {
        await this.prisma.deskPetEvent.create({
          data: { studentId, type, reaction: reaction as any, source },
        });
      } catch (e) {
        this.logger.warn(`桌宠事件持久化失败（不影响实时推送）: ${(e as Error).message}`);
      }
    }
    return { ok: true, topic, type, reaction };
  }

  // ---------------- 查询 ----------------

  async feed(studentId: string): Promise<DeskPetFeed> {
    const snap = this.latest.get(studentId);
    return {
      studentId,
      connected: true,
      mqtt: this.mqtt.status(),
      reaction: snap ? snap.reaction : null,
      type: snap ? snap.type : null,
    };
  }

  mqttStatus() {
    return this.mqtt.status();
  }

  async recentEvents(studentId: string, limit = 30): Promise<DeskPetEventView[]> {
    const rows = await this.prisma.deskPetEvent.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r: any) => ({
      id: r.id,
      studentId,
      type: r.type,
      reaction: r.reaction as PetReaction,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ---------------- 权限（与既有模块一致：家长/教师需已关联，学生需为自己） ----------------

  async assertStudentAccess(user: AuthUser, studentId: string): Promise<void> {
    const uid = (user as any).sub ?? (user as any).userId;
    if ((user as any).role === 'STUDENT') {
      if (uid !== studentId) throw new ForbiddenException('只能操作自己的桌宠');
      return;
    }
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { guardians: { select: { id: true } } },
    });
    if (!student) throw new ForbiddenException('学生不存在');
    const ownerOk = student.ownerId === uid;
    const guardianOk = student.guardians.some((g: any) => g.id === uid);
    if (!ownerOk && !guardianOk) throw new ForbiddenException('无权访问该学生桌宠');
  }

  private toDeviceView(d: any): DeskPetDeviceView {
    return {
      id: d.id,
      deviceId: d.deviceId,
      name: d.name,
      studentId: d.studentId,
      type: d.type,
      topicPrefix: d.topicPrefix,
      isActive: d.isActive,
      lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
    };
  }
}
