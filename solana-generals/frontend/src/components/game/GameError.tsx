import * as React from "react";

import { useNavigate } from "react-router-dom";

import { Text } from "../util/Text";
import { Button } from "../util/Button";

export function GameError({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <>
      <Text value="Something went wrong" isTitle={true} />
      <Text value={message ?? "Unknown error"} />
      <Button
        text="Go home"
        isSoft={true}
        onClick={() => {
          navigate("/");
        }}
      />
    </>
  );
}
