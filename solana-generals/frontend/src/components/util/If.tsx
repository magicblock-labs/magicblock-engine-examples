import * as React from "react";

export function If<Value>({
  value,
  renderer,
  placeholder,
}: {
  value: Value;
  renderer: (value: Value) => React.ReactElement;
  placeholder?: () => React.ReactElement;
}) {
  if (!value) {
    if (placeholder) {
      return placeholder();
    } else {
      return <></>;
    }
  }
  return renderer(value);
}
