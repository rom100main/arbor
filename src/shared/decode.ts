import { Either, Schema } from "effect"

/**
 * Field-level defaulting for untrusted JSON:
 * an absent or mistyped value falls back to `fallback` instead of failing the whole record.
 * Keeps the surrounding record strict (a bad `id` still rejects it) while optional fields stay forgiving.
 */
export const orDefault = <A, I>(
    schema: Schema.Schema<A, I>,
    fallback: () => A,
): Schema.Schema<A, unknown> =>
    Schema.transform(Schema.Unknown, schema, {
        decode: (value) => {
            const result = Schema.decodeUnknownEither(schema)(value)
            return Either.isRight(result) ? result.right : fallback()
        },
        encode: (value) => value,
        strict: false,
    })

/**
 * Record-level parsing:
 * `null` when `value` does not match `schema`,
 * so callers can skip one bad entry instead of dropping the whole payload.
 */
export const decodeOr =
    <A, I>(schema: Schema.Schema<A, I>) =>
    (value: unknown): A | null => {
        const result = Schema.decodeUnknownEither(schema)(value)
        return Either.isRight(result) ? result.right : null
    }
