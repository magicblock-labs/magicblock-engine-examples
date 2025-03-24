import * as React from "react";

import "./Text.scss";

export function Text({
  value,
  isTitle,
  isWarning,
  isFading,
}: {
  value: string;
  isTitle?: boolean;
  isWarning?: boolean;
  isFading?: boolean;
}) {
  const classNames = ["Text"];
  if (isTitle) {
    classNames.push("Title");
  }
  if (isWarning) {
    classNames.push("Warning");
  }
  if (isFading) {
    classNames.push("Fading");
  }
  return <div className={classNames.join(" ")}>{value}</div>;
}
