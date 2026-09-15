import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * 通用 ID 解析管道。
 * Prisma schema 使用 cuid()（无中横线的小写字母数字串）作为主键，
 * 也兼容 UUID 与任意非空白字符串（最长 64）。
 * 不再做格式硬校验：资源是否存在的判断交给服务层（findUnique → 404）。
 */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, string> {
  private static readonly RE = /^[A-Za-z0-9_-]{1,64}$/;

  transform(value: string, _meta: ArgumentMetadata): string {
    if (typeof value !== 'string' || !ParseIdPipe.RE.test(value)) {
      throw new BadRequestException(`Invalid id: ${value}`);
    }
    return value;
  }
}