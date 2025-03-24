import * as React from "react";

import { If } from "./If";

export function ForEach<Value>({
  values,
  before,
  renderer,
  placeholder,
}: {
  values?: Value[];
  renderer: (value: Value, index: number) => React.ReactElement;
  before?: () => React.ReactElement;
  placeholder?: () => React.ReactElement;
}) {
  if (!values || values.length <= 0) {
    return <If value={placeholder} renderer={placeholder} />;
  }
  return (
    <>
      <If value={before} renderer={before} />
      {values.map(renderer)}
    </>
  );
}
