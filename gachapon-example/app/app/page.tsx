"use client";

import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  Check,
  Circle,
  Copy,
  Gift,
  Play,
  RotateCcw,
  RefreshCw,
  RotateCw,
  Shuffle,
} from "lucide-react";
import {
  AnimationState,
  defaultDropPathSettings,
  DropPathSettings,
  GachaponScene,
  KnobAxis,
  ModelReport,
} from "@/components/gachapon-scene";

const states: AnimationState[] = [
  "idle",
  "aligning",
  "turning",
  "shaking",
  "dropping",
  "revealed",
];

const stateIcons = {
  idle: Circle,
  aligning: RotateCw,
  turning: RotateCw,
  shaking: Shuffle,
  dropping: Box,
  revealed: Gift,
};

const mockRewards = [
  "Common Capsule",
  "Rare Capsule",
  "Epic Capsule",
  "Legendary Capsule",
];

type DropPathPointKey = keyof DropPathSettings;
type DropPathAxis = keyof DropPathSettings["inside"];

const dropPathPoints: { key: DropPathPointKey; label: string }[] = [
  { key: "inside", label: "Inside" },
  { key: "chute", label: "Chute" },
  { key: "curve", label: "Curve" },
  { key: "front", label: "Front" },
];

const dropPathAxes: DropPathAxis[] = ["x", "y", "z"];

const initialReport: ModelReport = {
  source: "fallback",
  url: "/models/gachapon.glb",
  available: false,
  machineName: "ProceduralMachine",
  knobName: "ProceduralKnob",
  ballName: "ProceduralBall",
  error: null,
};

export default function GachaponTester() {
  const [animationState, setAnimationState] = useState<AnimationState>("idle");
  const [knobAxis, setKnobAxis] = useState<KnobAxis>("z");
  const [refreshKey, setRefreshKey] = useState(0);
  const [report, setReport] = useState<ModelReport>(initialReport);
  const [mockPulling, setMockPulling] = useState(false);
  const [pullCount, setPullCount] = useState(0);
  const [reward, setReward] = useState(mockRewards[0]);
  const [dropPath, setDropPath] = useState(defaultDropPathSettings);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const alignmentResolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedState = params.get("state");
    const requestedAxis = params.get("axis");

    if (states.includes(requestedState as AnimationState)) {
      setAnimationState(requestedState as AnimationState);
    }

    if (["x", "y", "z"].includes(requestedAxis ?? "")) {
      setKnobAxis(requestedAxis as KnobAxis);
    }
  }, []);

  const reportRows = useMemo(
    () => [
      ["Source", report.source === "glb" ? "GLB" : "Fallback"],
      ["Model", report.available ? "Loaded" : "Missing"],
      ["Machine", report.machineName ?? "Not found"],
      ["Knob", report.knobName ?? "Not found"],
      ["Ball", report.ballName ?? "Not found"],
      ["Path", report.url],
    ],
    [report],
  );

  const runMockPull = useCallback(async () => {
    if (mockPulling) {
      return;
    }

    setMockPulling(true);
    setPullCount((value) => value + 1);
    setReward(mockRewards[Math.floor(Math.random() * mockRewards.length)]);
    setCameraResetKey((value) => value + 1);

    const alignmentPromise = waitForMachineAlignment(alignmentResolveRef);
    setAnimationState("aligning");
    await alignmentPromise;
    await wait(500);
    setAnimationState("turning");
    await wait(2750);
    setAnimationState("dropping");
    await wait(9000);
    setMockPulling(false);
  }, [mockPulling]);

  const revealReward = useCallback(() => {
    if (mockPulling || animationState !== "dropping") {
      return;
    }

    setAnimationState("revealed");
  }, [animationState, mockPulling]);

  const handleMachineAligned = useCallback(() => {
    alignmentResolveRef.current?.();
    alignmentResolveRef.current = null;
  }, []);

  const dropPathCode = useMemo(
    () => JSON.stringify(dropPath, null, 2),
    [dropPath],
  );

  const updateDropPath = useCallback(
    (point: DropPathPointKey, axis: DropPathAxis, value: number) => {
      if (!Number.isFinite(value)) {
        return;
      }

      setDropPath((current) => ({
        ...current,
        [point]: {
          ...current[point],
          [axis]: value,
        },
      }));
    },
    [],
  );

  const resetDropPath = useCallback(() => {
    setDropPath(defaultDropPathSettings);
  }, []);

  const copyDropPath = useCallback(() => {
    void navigator.clipboard?.writeText(dropPathCode);
  }, [dropPathCode]);

  return (
    <main className="testerShell">
      <section className="scenePanel" aria-label="Gachapon model viewport">
        <GachaponScene
          animationState={animationState}
          knobAxis={knobAxis}
          dropPath={dropPath}
          refreshKey={refreshKey}
          cameraResetKey={cameraResetKey}
          onReport={setReport}
          onMachineAligned={handleMachineAligned}
        />
      </section>

      <aside className="controlPanel">
        <div className="titleBlock">
          <span className="eyebrow">Gachapon Example</span>
          <h1>Animation Tester</h1>
          <div className="stateReadout">
            <span>{animationState}</span>
            <span>{reward}</span>
          </div>
        </div>

        <div className="controlGroup">
          <button
            className="primaryButton"
            type="button"
            disabled={mockPulling}
            onClick={runMockPull}
          >
            <Play size={18} />
            Mock Pull
          </button>
          <button
            className="secondaryButton"
            type="button"
            disabled={mockPulling || animationState !== "dropping"}
            onClick={revealReward}
          >
            <Gift size={18} />
            Reveal
          </button>
          <button
            className="iconButton"
            type="button"
            aria-label="Refresh model"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="sectionBlock">
          <h2>Animation State</h2>
          <div className="stateGrid">
            {states.map((state) => {
              const Icon = stateIcons[state];
              const active = state === animationState;

              return (
                <button
                  key={state}
                  className={active ? "stateButton active" : "stateButton"}
                  type="button"
                  disabled={mockPulling}
                  onClick={() => setAnimationState(state)}
                >
                  <Icon size={16} />
                  <span>{state}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="sectionBlock">
          <h2>Knob Axis</h2>
          <div className="axisControl" role="radiogroup" aria-label="Knob rotation axis">
            {(["x", "y", "z"] as KnobAxis[]).map((axis) => (
              <button
                key={axis}
                className={knobAxis === axis ? "axisButton active" : "axisButton"}
                type="button"
                role="radio"
                aria-checked={knobAxis === axis}
                onClick={() => setKnobAxis(axis)}
              >
                {knobAxis === axis ? <Check size={14} /> : null}
                {axis.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="sectionBlock">
          <div className="sectionHeader">
            <h2>Drop Path</h2>
            <div className="pathActions">
              <button
                className="miniIconButton"
                type="button"
                aria-label="Copy drop path values"
                onClick={copyDropPath}
              >
                <Copy size={15} />
              </button>
              <button
                className="miniIconButton"
                type="button"
                aria-label="Reset drop path values"
                onClick={resetDropPath}
              >
                <RotateCcw size={15} />
              </button>
            </div>
          </div>
          <div className="pathGrid">
            <div className="pathAxisLabels" aria-hidden="true">
              <span />
              {dropPathAxes.map((axis) => (
                <span key={axis}>{axis.toUpperCase()}</span>
              ))}
            </div>
            {dropPathPoints.map((point) => (
              <div className="pathRow" key={point.key}>
                <span>{point.label}</span>
                {dropPathAxes.map((axis) => (
                  <input
                    key={axis}
                    aria-label={`${point.label} ${axis.toUpperCase()}`}
                    type="number"
                    inputMode="decimal"
                    min="-3"
                    max="3"
                    step="0.05"
                    value={dropPath[point.key][axis]}
                    onChange={(event) =>
                      updateDropPath(
                        point.key,
                        axis,
                        event.currentTarget.valueAsNumber,
                      )
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="sectionBlock">
          <h2>Model Objects</h2>
          <dl className="reportList">
            {reportRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {report.error ? <p className="errorText">{report.error}</p> : null}
        </div>

        <div className="mockStats">
          <div>
            <span>Mock pulls</span>
            <strong>{pullCount}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>
              {mockPulling
                ? "Running"
                : animationState === "dropping"
                  ? "Reveal"
                  : "Ready"}
            </strong>
          </div>
        </div>
      </aside>
    </main>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitForMachineAlignment(
  resolveRef: MutableRefObject<(() => void) | null>,
) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      if (resolveRef.current !== finish) {
        return;
      }

      resolveRef.current = null;
      resolve();
    };

    resolveRef.current = finish;
    window.setTimeout(finish, 3800);
  });
}
