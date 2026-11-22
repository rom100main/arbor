import "./ProgressBar.css"

export const ProgressBar = (props: { value: number | null; thin?: boolean; class?: string }) => (
    <span
        class={{
            "progress-track": true,
            "progress-track-thin": props.thin,
            ...(props.class ? { [props.class]: true } : {}),
        }}
        data-indeterminate={props.value === null ? "true" : "false"}
        aria-hidden="true"
    >
        <span class="progress-value" style={{ transform: `scaleX(${props.value ?? 0})` }} />
    </span>
)
