import { Option, Result, Schema, SchemaGetter } from "effect"

/**
 * Field-level defaulting for untrusted JSON:
 * an absent or mistyped value falls back to `fallback` instead of failing the whole record.
 * Keeps the surrounding record strict (a bad `id` still rejects it) while optional fields stay forgiving.
 */
export const orDefault = <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    fallback: () => S["Type"],
) =>
    Schema.optionalKey(Schema.Unknown).pipe(
        Schema.decodeTo(Schema.toType(schema), {
            decode: SchemaGetter.transformOptional((value) => {
                const result = Schema.decodeUnknownResult(schema)(Option.getOrUndefined(value))
                return Option.some(Result.isSuccess(result) ? result.success : fallback())
            }),
            encode: SchemaGetter.passthroughSupertype(),
        }),
    )

/**
 * Record-level parsing:
 * `null` when `value` does not match `schema`,
 * so callers can skip one bad entry instead of dropping the whole payload.
 */
export const decodeOr =
    <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
    (value: unknown): S["Type"] | null => {
        const result = Schema.decodeUnknownResult(schema)(value)
        return Result.isSuccess(result) ? result.success : null
    }
