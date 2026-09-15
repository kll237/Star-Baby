import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PetReaction, DeskPetEventType } from './deskpet.taxonomy';

/** 服务端内部事件：桌宠反应（由 DeskPetService 产出，驱动 WebSocket 网关广播）。 */
export interface DeskPetReactionEvent {
  studentId: string;
  type: DeskPetEventType;
  reaction: PetReaction;
  ts: string;
}

/**
 * 进程内事件总线：解耦 DeskPetService 与 DeskPetGateway，
 * 避免服务与网关之间的直接循环依赖。
 */
@Injectable()
export class DeskPetBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emitReaction(evt: DeskPetReactionEvent): void {
    this.emitter.emit('reaction', evt);
  }

  onReaction(handler: (evt: DeskPetReactionEvent) => void): () => void {
    this.emitter.on('reaction', handler);
    return () => this.emitter.off('reaction', handler);
  }
}
