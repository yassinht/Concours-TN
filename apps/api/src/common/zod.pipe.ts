import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, infer as ZInfer } from 'zod';

/** Usage: `@Body(new ZodPipe(RegisterInput)) body: RegisterInput` */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, ZInfer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): ZInfer<T> {
    const r = this.schema.safeParse(value);
    if (!r.success) throw new BadRequestException({ message: 'VALIDATION_FAILED', issues: r.error.issues });
    return r.data;
  }
}
