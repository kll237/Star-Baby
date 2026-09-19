import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { computeCompositeScore, normalizeScores } from '../src/detection/detection.math';
import { EMOTION_KEYS } from '../src/detection/detection.taxonomy';
import { COMFORT_SCRIPTS } from '../src/chat/chat.scripts';
import { KNOWLEDGE_ITEMS } from '../src/advice/advice.knowledge';

const prisma = new PrismaClient();

/** 演示用固定人脸向量（与学生端「演示登录」按钮保持一致，仅用于无摄像头演示） */
function demoVector(): number[] {
  const v: number[] = [];
  for (let i = 0; i < 128; i++) {
    const x = Math.sin(i * 12.9898) * 43758.5453;
    v.push(Math.round((x - Math.floor(x)) * 1000) / 1000);
  }
  return v;
}

async function main() {
  const passwordHash = await bcrypt.hash('Demo@123456', 10);

  const parent = await prisma.user.upsert({
    where: { account: 'parent01' },
    update: {},
    create: {
      account: 'parent01',
      passwordHash,
      nickname: '演示家长',
      phone: '13800000001',
      role: 'PARENT',
    },
  });

  const teacher = await prisma.user.upsert({
    where: { account: 'teacher01' },
    update: {},
    create: {
      account: 'teacher01',
      passwordHash,
      nickname: '演示教师',
      phone: '13800000002',
      role: 'TEACHER',
    },
  });

  // 管理员账户：超级角色，可访问所有受 @Roles() 保护的接口（见 RolesGuard）
  const admin = await prisma.user.upsert({
    where: { account: 'admin01' },
    update: {},
    create: {
      account: 'admin01',
      passwordHash,
      nickname: '系统管理员',
      phone: '13800000000',
      role: 'ADMIN',
    },
  });

  // 为学生端演示创建一名学生（无密码，由家长创建）
  let student = await prisma.student.findFirst({
    where: { name: '演示学生-小明', ownerId: parent.id },
  });
  if (!student) {
    student = await prisma.student.create({
      data: { name: '演示学生-小明', gender: 'MALE', ownerId: parent.id },
    });
  }
  // 关联教师为监护人
  await prisma.student.update({
    where: { id: student.id },
    data: { guardians: { connect: { id: teacher.id } } },
  });

  // 演示人脸向量（AES 加密由运行期完成，这里仅写入明文占位以驱动演示登录；
  // 真实注册流程由前端走 AES-256-GCM 加密后写入 payload 字段）
  const hasFace = await prisma.faceDescriptor.count({ where: { studentId: student.id } });
  if (hasFace === 0) {
    await prisma.faceDescriptor.create({
      data: {
        studentId: student.id,
        payload: JSON.stringify({ demo: true, vector: demoVector() }),
        algorithm: 'FACE_API_TINY',
        livenessPassed: true,
        angle: 'front',
      },
    });
  }

  // 预置一段演示检测会话（供看板/报告展示）
  const existingSession = await prisma.detectionSession.count({
    where: { studentId: student.id, deviceInfo: 'demo-seed' },
  });
  if (existingSession === 0) {
    const session = await prisma.detectionSession.create({
      data: {
        studentId: student.id,
        source: 'CAMERA',
        status: 'ENDED',
        fps: 18,
        deviceInfo: 'demo-seed',
        startedAt: new Date(Date.now() - 1000 * 60 * 30),
        endedAt: new Date(Date.now() - 1000 * 60 * 25),
      },
    });
    const start = session.startedAt.getTime();
    // 脚本化情绪曲线：前半段平静，中段出现负向波动，末段恢复
    for (let i = 0; i < 40; i++) {
      let scores: Record<string, number>;
      if (i < 20) {
        scores = { neutral: 70, happy: 20, surprise: 6, sad: 2, angry: 1, fear: 1, disgust: 0 };
      } else if (i < 28) {
        scores = { neutral: 15, sad: 45, angry: 8, fear: 20, surprise: 6, happy: 4, disgust: 2 };
      } else {
        scores = { neutral: 55, happy: 30, surprise: 8, sad: 4, angry: 2, fear: 1, disgust: 0 };
      }
      const comp = computeCompositeScore(normalizeScores(scores));
      await prisma.emotionFrame.create({
        data: {
          sessionId: session.id,
          studentId: student.id,
          ts: new Date(start + i * 1000 * 7),
          scores: scores as any,
          dominant: comp.dominant,
          compositeScore: comp.compositeScore,
          negative: comp.negative,
        },
      });
    }
    // 几个行为事件
    const behaviorSpec: [number, string, number][] = [
      [5, 'sit_still', 0.9],
      [12, 'wave', 0.7],
      [22, 'cover_face', 0.8],
      [25, 'shake_head', 0.75],
      [33, 'clap', 0.82],
    ];
    for (const [idx, behavior, confidence] of behaviorSpec) {
      await prisma.behaviorEvent.create({
        data: {
          sessionId: session.id,
          studentId: student.id,
          ts: new Date(start + idx * 1000 * 7),
          behavior,
          confidence,
          source: 'motion',
        },
      });
    }
    void EMOTION_KEYS;
  }

  console.log('✅ 演示数据已写入：');
  console.log('   家长端: parent01 / Demo@123456 (手机 13800000001)');
  console.log('   教师端: teacher01 / Demo@123456 (手机 13800000002)');
  console.log('   管理员: admin01 / Demo@123456 (超级角色，可访问全部接口)');
  console.log('   学生端: 演示学生-小明（已预置人脸，可用「演示登录」按钮）');
  console.log('   预置检测会话: 1 段（含 40 帧情绪 + 5 个行为事件）');

  // 阶段三：播种 CBT / 正念安抚话术库（≥50 条）
  const scriptCount = await prisma.comfortScript.count();
  if (scriptCount === 0) {
    await prisma.comfortScript.createMany({
      data: COMFORT_SCRIPTS.map((s) => ({
        category: s.category,
        technique: s.technique,
        triggerEmotion: s.triggerEmotion ?? null,
        content: s.content,
        followUp: s.followUp ?? null,
        tone: s.tone ?? 'warm',
        tags: s.tags ?? [],
        priority: s.priority ?? 0,
        isActive: s.isActive ?? true,
      })) as any,
    });
    console.log(`   安抚话术库: ${COMFORT_SCRIPTS.length} 条（CBT/正念/呼吸/着陆/共情/鼓励/转移/常规）`);
  } else {
    console.log(`   安抚话术库: 已存在 ${scriptCount} 条，跳过`);
  }

  // 阶段五：播种专业心理建议知识库（≥200 条）
  const kbCount = await prisma.knowledgeItem.count();
  if (kbCount === 0) {
    const existingTitles = new Set<string>();
    for (const k of KNOWLEDGE_ITEMS) {
      if (existingTitles.has(k.title)) continue;
      existingTitles.add(k.title);
      await prisma.knowledgeItem.create({
        data: {
          category: k.category,
          title: k.title,
          content: k.content,
          summary: k.summary ?? k.content.slice(0, 60),
          source: k.source ?? null,
          severity: k.severity ?? 'LOW',
          target: k.target ?? 'ALL',
          applicableEmotions: k.applicableEmotions ?? [],
          applicableBehaviors: k.applicableBehaviors ?? [],
          tags: k.tags ?? [],
          reference: k.reference ?? null,
          priority: k.priority ?? 0,
          isActive: k.isActive ?? true,
        },
      });
    }
    console.log(`   专业建议知识库: ${KNOWLEDGE_ITEMS.length} 条（情绪调节/社交技能/行为干预/感统/沟通/家庭/学校/危机/家长/教师/认知/常规）`);
  } else {
    console.log(`   专业建议知识库: 已存在 ${kbCount} 条，跳过`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
