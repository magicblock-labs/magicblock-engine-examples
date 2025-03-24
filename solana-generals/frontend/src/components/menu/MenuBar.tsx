import * as React from "react";

import { useNavigate } from "react-router-dom";

import { MenuWallet } from "./MenuWallet";
import { MenuSession } from "./MenuSession";

import "./MenuBar.scss";

export function MenuBar() {
  const navigate = useNavigate();
  return (
    <div className="MenuBar">
      <button
        className="TopBar"
        onClick={() => {
          navigate("/");
        }}
      >
        <div className="Text">MagicBlock Labs - Generals</div>
      </button>
      <div className="KeysBar ContainerOuter Centered Horizontal">
        <MenuSession />
        <div className="Separator"></div>
        <MenuWallet />
      </div>
    </div>
  );
}
