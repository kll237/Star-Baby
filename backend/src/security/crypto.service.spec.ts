import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

describe('CryptoService (AES-256-GCM)', () => {
  let service: CryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'aesMasterKey' ? '00'.repeat(32) : '') } },
      ],
    }).compile();
    service = module.get<CryptoService>(CryptoService);
    service.onModuleInit();
  });

  it('字符串加解密可往返', () => {
    const plain = '敏感的人脸特征数据';
    const enc = service.encrypt(plain);
    expect(enc).not.toContain(plain);
    expect(service.decrypt(enc)).toBe(plain);
  });

  it('向量加解密可往返且顺序保持一致', () => {
    const vec = [0.123, -0.456, 0.789, 1.0, -1.0];
    const enc = service.encryptVector(vec);
    expect(service.decryptVector(enc)).toEqual(vec);
  });

  it('不同明文密文不同（随机 IV）', () => {
    const a = service.encrypt('x');
    const b = service.encrypt('x');
    expect(a).not.toBe(b);
  });
});
