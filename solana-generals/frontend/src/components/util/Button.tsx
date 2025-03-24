import * as React from "react";

import { Text } from "./Text";

import "./Button.scss";

export function Button({
  icon,
  text,
  isSoft,
  onClick,
}: {
  icon?: string;
  text: string;
  isSoft?: boolean;
  onClick?: () => void;
}) {
  const classNames = ["Button"];
  if (isSoft) {
    classNames.push("Soft");
  }
  return (
    <button className={classNames.join(" ")} onClick={onClick}>
      {icon ? <img className="Icon" src={icon} /> : undefined}
      <Text value={text} />
    </button>
  );
}
