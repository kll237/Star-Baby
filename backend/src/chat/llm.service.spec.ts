import { ConfigService } from '@nestjs/config';
import { LlmService, RuleLlmService, MockLlmService } from './llm.service';
import type { LlmRequest } from './llm.service';

function makeConfig(provider?: string): ConfigService {
  const cfg: Record<string, any> = { llm: { provider } };
  return { get: (k: string) => cfg[k] } as unknown as ConfigService;
}

const req = (ctx: any = {}, name = '小明'): LlmRequest => ({
  studentName: name,
  emotionKey: 'angry',
  negative: true,
  history: [],
  context: { emotionKey: 'angry', negative: true, studentName: name, ...ctx },
});

describe('LlmService（可切换）', () => {
  it('默认提供方为 RULE 且始终可用', () => {
    const svc = new LlmService(makeConfig());
    expect(svc.provider).toBe('RULE');
    expect(svc.isConfigured()).toBe(true);
  });

  it('RULE 回复来自话术库并含学生昵称', async () => {
    const r = await new RuleLlmService().reply(req());
    expect(r.provider).toBe('RULE');
    expect(r.content).toContain('小明');
  });

  it('MOCK 返回稳定演示语', async () => {
    const r = await new MockLlmService().reply(req());
    expect(r.provider).toBe('MOCK');
    expect(r.content).toContain('慢慢来');
  });

  it('运行期切换到 MOCK', async () => {
    const svc = new LlmService(makeConfig());
    svc.setProvider('MOCK');
    expect(svc.provider).toBe('MOCK');
    const r = await svc.reply(req());
    expect(r.provider).toBe('MOCK');
  });

  it('切换到 OPENAI 但无密钥时自动降级规则引擎（fallback）', async () => {
    const svc = new LlmService(makeConfig());
    svc.setProvider('OPENAI');
    expect(svc.provider).toBe('OPENAI');
    expect(svc.isConfigured()).toBe(false);
    const r = await svc.reply(req());
    expect(r.provider).toBe('OPENAI');
    expect(r.fallback).toBe(true);
    expect(r.content).toContain('小明');
  });

  it('status 暴露可用提供方列表', () => {
    const svc = new LlmService(makeConfig());
    expect(svc.status().available).toEqual(['RULE', 'MOCK', 'OPENAI']);
  });
});
