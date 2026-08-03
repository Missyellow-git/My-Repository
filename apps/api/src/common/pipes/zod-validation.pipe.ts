import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodType, ZodTypeDef } from 'zod';
import { ValidationException } from '../errors';

/**
 * Validates a handler argument against a Zod schema and returns the *parsed*
 * value, so downstream code receives coerced, defaulted, typed data rather than
 * raw strings from the query string.
 *
 * Used per-parameter via `@Query(new ZodValidationPipe(schema))` rather than
 * globally: the same endpoint often has a differently-shaped body and query,
 * and a global pipe cannot tell them apart without extra metadata.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  /**
   * The input type is deliberately `unknown` rather than tied to `T`: query
   * schemas routinely transform (a comma-joined `symbols` string becomes a
   * `string[]`), so the parsed output and the raw input are different shapes.
   */
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ValidationException(formatZodError(result.error));
  }
}

export function formatZodError(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}
