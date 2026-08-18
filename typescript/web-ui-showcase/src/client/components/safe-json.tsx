export function SafeJson(props: { value: unknown }): JSX.Element {
  let text: string;
  try {
    text = JSON.stringify(props.value, null, 2);
  } catch {
    text = "{\n  \"error\": \"Unable to serialize this redacted event\"\n}";
  }
  return <pre className="safe-json">{text}</pre>;
}
