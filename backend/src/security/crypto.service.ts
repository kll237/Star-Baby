import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * 人脸特征等敏感数据的 AES-256-GCM 加密服务。
 * 密钥来自环境 AES_MASTER_KEY（32 字节 = 64 位十六进制）。
 * 输出格式：ivBase64:tagBase64:cipherBase64
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private key: Buffer;
  private readonly algorithm = 'aes-256-gcm';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const hex = this.config.get<string>('aesMasterKey') || '';
    if (!hex || hex.length !== 64) {
      this.logger.warn(
        'AES_MASTER_KEY 未配置或长度不为 64 位十六进制，正在使用临时开发密钥（生产环境务必配置！）',
      );
      this.key = crypto.createHash('sha256').update('dev-insecure-key').digest();
    } else {
      this.key = Buffer.from(hex, 'hex');
    }
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      tag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /** 加密人脸特征向量（number[]） */
  encryptVector(vec: number[]): string {
    return this.encrypt(JSON.stringify(vec));
  }

  /** 解密人脸特征向量 */
  decryptVector(payload: string): number[] {
    return JSON.parse(this.decrypt(payload)) as number[];
  }
}
