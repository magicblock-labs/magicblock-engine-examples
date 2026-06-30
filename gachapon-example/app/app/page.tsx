"use client";

import { Buffer } from "buffer";
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
  ExternalLink,
  Gift,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Shuffle,
  Wallet,
} from "lucide-react";
import type { Keypair, PublicKey } from "@solana/web3.js";
import {
  CoreAssetAccount,
  DEVNET_RPC_URL,
  DEFAULT_VRF_QUEUE,
  GachaponAccounts,
  MachineAccount,
  MPL_CORE_PROGRAM_ID,
  PROGRAM_ID,
  PendingPullAccount,
  REWARDS,
  VRF_PROGRAM_ID,
  buildInitInstruction,
  buildPullInstruction,
  buildUploadConfigInstruction,
  decodeCoreAsset,
  decodeMachine,
  decodePendingPull,
  devnetConnection,
  ensureLocalWalletFunds,
  explorerAddress,
  explorerTx,
  findGachaponAccounts,
  isSettled,
  loadOrCreateLocalKeypair,
  sendLocalWalletTransaction,
  shortKey,
} from "@/lib/gachapon-devnet";
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

type DropPathPointKey = keyof DropPathSettings;
type DropPathAxis = keyof DropPathSettings["inside"];
type StepStatus = "idle" | "active" | "done" | "error";

type VerifyLink = {
  label: string;
  href: string;
};

type VerifyStep = {
  id: "init" | "config" | "request" | "settlement" | "asset";
  label: string;
  status: StepStatus;
  detail: string;
  links: VerifyLink[];
};

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

const initialSteps: VerifyStep[] = [
  {
    id: "init",
    label: "Init",
    status: "idle",
    detail: "Machine not created",
    links: [],
  },
  {
    id: "config",
    label: "Config",
    status: "idle",
    detail: "Templates not uploaded",
    links: [],
  },
  {
    id: "request",
    label: "VRF Request",
    status: "idle",
    detail: "Pull not requested",
    links: [],
  },
  {
    id: "settlement",
    label: "Settlement",
    status: "idle",
    detail: "Callback not observed",
    links: [],
  },
  {
    id: "asset",
    label: "Core Asset",
    status: "idle",
    detail: "Asset not minted",
    links: [],
  },
];

export default function GachaponTester() {
  const connection = useMemo(() => devnetConnection(), []);
  const [animationState, setAnimationState] = useState<AnimationState>("idle");
  const [knobAxis, setKnobAxis] = useState<KnobAxis>("z");
  const [refreshKey, setRefreshKey] = useState(0);
  const [report, setReport] = useState<ModelReport>(initialReport);
  const [dropPath, setDropPath] = useState(defaultDropPathSettings);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [localWallet, setLocalWallet] = useState<Keypair | null>(null);
  const [walletKey, setWalletKey] = useState<PublicKey | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<GachaponAccounts | null>(null);
  const [machineAccount, setMachineAccount] = useState<MachineAccount | null>(
    null,
  );
  const [pendingPull, setPendingPull] = useState<PendingPullAccount | null>(
    null,
  );
  const [coreAsset, setCoreAsset] = useState<CoreAssetAccount | null>(null);
  const [assetOwner, setAssetOwner] = useState<PublicKey | null>(null);
  const [steps, setSteps] = useState<VerifyStep[]>(initialSteps);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isAwaitingReveal, setIsAwaitingReveal] = useState(false);
  const [simulatedRewardId, setSimulatedRewardId] = useState<number | null>(
    null,
  );
  const [pullCount, setPullCount] = useState(0);
  const [simulationCount, setSimulationCount] = useState(0);
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

    const keypair = loadOrCreateLocalKeypair();
    setLocalWallet(keypair);
    setWalletKey(keypair.publicKey);
  }, []);

  const selectedReward = useMemo(() => {
    if (!pendingPull || pendingPull.rewardId >= REWARDS.length) {
      return simulatedRewardId === null ? null : REWARDS[simulatedRewardId];
    }

    return REWARDS[pendingPull.rewardId];
  }, [pendingPull, simulatedRewardId]);

  const activeRewardName = isAwaitingReveal
    ? "Tap capsule to reveal"
    : isSimulating
      ? "Simulating pull"
      : coreAsset?.name ?? selectedReward?.name ?? "Awaiting pull";

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

  const staticLinks = useMemo(
    () => [
      { label: "Program", href: explorerAddress(PROGRAM_ID) },
      { label: "Metaplex Core", href: explorerAddress(MPL_CORE_PROGRAM_ID) },
      { label: "VRF Program", href: explorerAddress(VRF_PROGRAM_ID) },
      { label: "VRF Queue", href: explorerAddress(DEFAULT_VRF_QUEUE) },
    ],
    [],
  );

  const prepareLocalWallet = useCallback(async () => {
    const keypair = localWallet ?? loadOrCreateLocalKeypair();
    setIsFunding(true);

    try {
      setLocalWallet(keypair);
      setWalletKey(keypair.publicKey);
      const balance = await ensureLocalWalletFunds(connection, keypair);
      setWalletBalance(balance);
      setFlowError(null);
      return keypair;
    } finally {
      setIsFunding(false);
    }
  }, [connection, localWallet]);

  const handlePrepareLocalWallet = useCallback(async () => {
    try {
      await prepareLocalWallet();
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : String(error));
    }
  }, [prepareLocalWallet]);

  const findSettlementSignature = useCallback(
    async (asset: PublicKey, requestSignature: string) => {
      const signatures = await connection.getSignaturesForAddress(asset, {
        limit: 8,
      });

      return (
        signatures.find((signature) => signature.signature !== requestSignature)
          ?.signature ?? signatures[0]?.signature
      );
    },
    [connection],
  );

  const waitForSettlement = useCallback(
    async (
      nextAccounts: GachaponAccounts,
      requestSignature: string,
      onPoll: (pull: PendingPullAccount) => void,
    ) => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < 180_000) {
        const pull = await fetchPendingPull(connection, nextAccounts.pendingPull);
        onPoll(pull);

        if (isSettled(pull)) {
          const assetAccount = await connection.getAccountInfo(
            nextAccounts.asset,
            "confirmed",
          );

          if (!assetAccount) {
            throw new Error("Pull settled but Core asset account was not found");
          }

          const coreAsset = decodeCoreAsset(Buffer.from(assetAccount.data));
          const settlementSignature = await findSettlementSignature(
            nextAccounts.asset,
            requestSignature,
          );

          return { pull, assetAccount, coreAsset, settlementSignature };
        }

        await wait(3_000);
      }

      throw new Error("Timed out waiting for the VRF callback");
    },
    [connection, findSettlementSignature],
  );

  const runDevnetPull = useCallback(async () => {
    if (isRunning || isFunding || isSimulating || isAwaitingReveal) {
      return;
    }

    setIsRunning(true);
    setFlowError(null);
    setMachineAccount(null);
    setPendingPull(null);
    setCoreAsset(null);
    setAssetOwner(null);
    setIsAwaitingReveal(false);
    setSimulatedRewardId(null);
    setSteps(initialSteps);
    setCameraResetKey((value) => value + 1);

    try {
      const keypair = await prepareLocalWallet();
      const publicKey = keypair.publicKey;
      const nextAccounts = findGachaponAccounts(publicKey);
      const clientSeed = window.crypto.getRandomValues(new Uint8Array(1))[0];

      setAccounts(nextAccounts);
      setPullCount((value) => value + 1);
      updateStep("init", {
        status: "active",
        detail: `Creating ${shortKey(nextAccounts.machine)}`,
        links: accountLinks(nextAccounts, publicKey),
      });

      const initSignature = await sendLocalWalletTransaction(
        connection,
        keypair,
        buildInitInstruction(publicKey, nextAccounts),
      );
      const initMachine = await fetchMachine(connection, nextAccounts.machine);
      setMachineAccount(initMachine);
      updateStep("init", {
        status: "done",
        detail: "Machine created",
        links: [
          txLink("Init tx", initSignature),
          addressLink("Machine", nextAccounts.machine),
          addressLink("Treasury", nextAccounts.treasury),
          addressLink("Update authority", nextAccounts.updateAuthority),
        ],
      });

      updateStep("config", {
        status: "active",
        detail: "Uploading placeholder templates",
        links: [addressLink("Machine", nextAccounts.machine)],
      });

      const configSignature = await sendLocalWalletTransaction(
        connection,
        keypair,
        buildUploadConfigInstruction(publicKey, nextAccounts),
      );
      const configuredMachine = await fetchMachine(
        connection,
        nextAccounts.machine,
      );
      setMachineAccount(configuredMachine);
      updateStep("config", {
        status: "done",
        detail: `${configuredMachine.totalWeight} total weight`,
        links: [
          txLink("Config tx", configSignature),
          addressLink("Machine", nextAccounts.machine),
        ],
      });

      const alignmentPromise = waitForMachineAlignment(alignmentResolveRef);
      setAnimationState("aligning");
      await alignmentPromise;
      setAnimationState("turning");

      updateStep("request", {
        status: "active",
        detail: "Submitting VRF request",
        links: [
          addressLink("Pending pull", nextAccounts.pendingPull),
          addressLink("Asset PDA", nextAccounts.asset),
          addressLink("VRF queue", DEFAULT_VRF_QUEUE),
        ],
      });

      const requestSignature = await sendLocalWalletTransaction(
        connection,
        keypair,
        buildPullInstruction(publicKey, nextAccounts, clientSeed),
        { skipPreflight: true },
      );
      const requestedPull = await fetchPendingPull(
        connection,
        nextAccounts.pendingPull,
      );
      setPendingPull(requestedPull);
      updateStep("request", {
        status: "done",
        detail: `Pending pull ${requestedPull.pullId.toString()}`,
        links: [
          txLink("Request tx", requestSignature),
          addressLink("Pending pull", nextAccounts.pendingPull),
          addressLink("Asset PDA", nextAccounts.asset),
          addressLink("VRF program", VRF_PROGRAM_ID),
        ],
      });

      await wait(900);
      setAnimationState("dropping");
      updateStep("settlement", {
        status: "active",
        detail: "Waiting for callback",
        links: [addressLink("Pending pull", nextAccounts.pendingPull)],
      });

      const settled = await waitForSettlement(
        nextAccounts,
        requestSignature,
        (pull) => {
          setPendingPull(pull);
          updateStep("settlement", {
            status: "active",
            detail: `Status ${pull.status}`,
            links: [addressLink("Pending pull", nextAccounts.pendingPull)],
          });
        },
      );

      setPendingPull(settled.pull);
      setCoreAsset(settled.coreAsset);
      setAssetOwner(settled.assetAccount.owner);
      setMachineAccount(await fetchMachine(connection, nextAccounts.machine));
      setAnimationState("revealed");

      updateStep("settlement", {
        status: "done",
        detail: "Callback settled",
        links: [
          ...(settled.settlementSignature
            ? [txLink("Callback tx", settled.settlementSignature)]
            : []),
          addressLink("Pending pull", nextAccounts.pendingPull),
        ],
      });
      updateStep("asset", {
        status: "done",
        detail: settled.coreAsset.name,
        links: [
          addressLink("Core asset", nextAccounts.asset),
          addressLink("Owner", settled.coreAsset.owner),
          ...(settled.coreAsset.updateAuthority
            ? [addressLink("Update authority", settled.coreAsset.updateAuthority)]
            : []),
          addressLink("Core program", settled.assetAccount.owner),
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFlowError(message);
      setAnimationState("idle");
      markActiveStepFailed(message);
    } finally {
      setIsRunning(false);
    }
  }, [
    connection,
    isFunding,
    isAwaitingReveal,
    isRunning,
    isSimulating,
    prepareLocalWallet,
  ]);

  const runSimulatedPull = useCallback(async () => {
    if (isRunning || isFunding || isSimulating || isAwaitingReveal) {
      return;
    }

    setIsSimulating(true);
    setFlowError(null);
    setPendingPull(null);
    setCoreAsset(null);
    setAssetOwner(null);
    setIsAwaitingReveal(false);
    setSteps(initialSteps);
    setSimulatedRewardId(null);
    setSimulationCount((value) => value + 1);
    setCameraResetKey((value) => value + 1);

    try {
      const alignmentPromise = waitForMachineAlignment(alignmentResolveRef);
      setAnimationState("aligning");
      await alignmentPromise;
      setAnimationState("turning");
      await wait(2_400);
      setAnimationState("dropping");
      await wait(6_900);
      setIsAwaitingReveal(true);
    } finally {
      setIsSimulating(false);
    }
  }, [isAwaitingReveal, isFunding, isRunning, isSimulating]);

  const handleMachineAligned = useCallback(() => {
    alignmentResolveRef.current?.();
    alignmentResolveRef.current = null;
  }, []);

  const handleCapsulePress = useCallback(() => {
    if (!isAwaitingReveal || animationState !== "dropping") {
      return;
    }

    setSimulatedRewardId(pickWeightedRewardId());
    setIsAwaitingReveal(false);
    setAnimationState("revealed");
  }, [animationState, isAwaitingReveal]);

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
          onCapsulePress={handleCapsulePress}
        />
      </section>

      <aside className="controlPanel">
        <div className="titleBlock">
          <span className="eyebrow">Devnet Gachapon</span>
          <h1>Pull Console</h1>
          <div className="stateReadout">
            <span>{animationState}</span>
            <span>{activeRewardName}</span>
          </div>
        </div>

        <div className="controlGroup">
          <div className="pullActionStack">
            <button
              className="primaryButton"
              type="button"
              disabled={isRunning || isFunding || isSimulating || isAwaitingReveal}
              onClick={runDevnetPull}
            >
              {isRunning ? <Loader2 className="spinIcon" size={18} /> : <Play size={18} />}
              Devnet Pull
            </button>
            <button
              className="simulateButton"
              type="button"
              disabled={isRunning || isFunding || isSimulating || isAwaitingReveal}
              onClick={runSimulatedPull}
            >
              {isSimulating ? (
                <Loader2 className="spinIcon" size={18} />
              ) : (
                <Shuffle size={18} />
              )}
              Simulate Pull
            </button>
          </div>
          <button
            className="secondaryButton"
            type="button"
            disabled={isRunning || isFunding || isSimulating || isAwaitingReveal}
            onClick={handlePrepareLocalWallet}
          >
            {isFunding ? <Loader2 className="spinIcon" size={18} /> : <Wallet size={18} />}
            {walletKey ? shortKey(walletKey) : "Local"}
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

        {flowError ? <p className="errorText">{flowError}</p> : null}

        <div className="sectionBlock">
          <h2>Verification</h2>
          <div className="stepList">
            {steps.map((step) => (
              <div className={`stepRow ${step.status}`} key={step.id}>
                <div className="stepStatus" aria-hidden="true">
                  {step.status === "done" ? (
                    <Check size={15} />
                  ) : step.status === "active" ? (
                    <Loader2 className="spinIcon" size={15} />
                  ) : (
                    <Circle size={15} />
                  )}
                </div>
                <div className="stepBody">
                  <div className="stepCopy">
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                  {step.links.length > 0 ? (
                    <div className="linkGrid">
                      {step.links.map((link) => (
                        <ExplorerAnchor key={`${step.id}-${link.label}`} link={link} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sectionBlock">
          <h2>Live Accounts</h2>
          <dl className="reportList">
            <AccountRow label="Wallet" value={walletKey} />
            <TextRow label="Balance" value={formatSolBalance(walletBalance)} />
            <TextRow label="RPC" value={DEVNET_RPC_URL} />
            <AccountRow label="Machine" value={accounts?.machine ?? null} />
            <AccountRow label="Pending" value={accounts?.pendingPull ?? null} />
            <AccountRow label="Asset" value={accounts?.asset ?? null} />
            <AccountRow label="Owner" value={assetOwner} />
          </dl>
        </div>

        <div className="sectionBlock">
          <h2>Reward Templates</h2>
          <div className="rewardList">
            {REWARDS.map((reward, index) => {
              const mintedCount = machineAccount?.rewards[index]?.mintedCount ?? 0n;
              const active =
                (pendingPull?.rewardId === index && pendingPull.status === 1) ||
                simulatedRewardId === index;

              return (
                <div className={active ? "rewardRow active" : "rewardRow"} key={reward.name}>
                  <div>
                    <strong>{reward.name}</strong>
                    <span>{reward.uri}</span>
                  </div>
                  <span>{reward.weight}%</span>
                  <span>{mintedCount.toString()}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="sectionBlock">
          <h2>Static Links</h2>
          <div className="linkGrid staticLinks">
            {staticLinks.map((link) => (
              <ExplorerAnchor key={link.label} link={link} />
            ))}
          </div>
        </div>

        {coreAsset ? (
          <div className="sectionBlock">
            <h2>Minted Asset</h2>
            <dl className="reportList">
              <TextRow label="Name" value={coreAsset.name} />
              <TextRow label="URI" value={coreAsset.uri} />
              <TextRow
                label="Machine"
                value={coreAsset.attributes.get("machine") ?? "Missing"}
              />
              <TextRow
                label="Pull ID"
                value={coreAsset.attributes.get("pull_id") ?? "Missing"}
              />
              <TextRow
                label="Reward ID"
                value={coreAsset.attributes.get("reward_id") ?? "Missing"}
              />
            </dl>
          </div>
        ) : null}

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
                  disabled={isRunning || isFunding || isSimulating || isAwaitingReveal}
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
              <TextRow key={label} label={label} value={value} />
            ))}
          </dl>
          {report.error ? <p className="errorText">{report.error}</p> : null}
        </div>

        <div className="mockStats">
          <div>
            <span>Devnet pulls</span>
            <strong>{pullCount}</strong>
          </div>
          <div>
            <span>Simulations</span>
            <strong>{simulationCount}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>
              {isRunning
                ? "Running"
                : isSimulating
                  ? "Simulating"
                  : isAwaitingReveal
                    ? "Tap capsule"
                  : pendingPull?.status === 1
                    ? "Settled"
                    : "Ready"}
            </strong>
          </div>
        </div>
      </aside>
    </main>
  );

  function updateStep(
    id: VerifyStep["id"],
    patch: Pick<VerifyStep, "status" | "detail" | "links">,
  ) {
    setSteps((current) =>
      current.map((step) => (step.id === id ? { ...step, ...patch } : step)),
    );
  }

  function markActiveStepFailed(message: string) {
    setSteps((current) =>
      current.map((step) =>
        step.status === "active"
          ? { ...step, status: "error", detail: message }
          : step,
      ),
    );
  }
}

function AccountRow({
  label,
  value,
}: {
  label: string;
  value: PublicKey | null | undefined;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value ? (
          <a href={explorerAddress(value)} target="_blank" rel="noreferrer">
            {value.toBase58()}
          </a>
        ) : (
          "Pending"
        )}
      </dd>
    </div>
  );
}

function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatSolBalance(value: number | null) {
  return value === null ? "Not checked" : `${value.toFixed(3)} SOL`;
}

function ExplorerAnchor({ link }: { link: VerifyLink }) {
  return (
    <a href={link.href} target="_blank" rel="noreferrer">
      <ExternalLink size={13} />
      {link.label}
    </a>
  );
}

function accountLinks(accounts: GachaponAccounts, player: PublicKey) {
  return [
    addressLink("Wallet", player),
    addressLink("Machine", accounts.machine),
    addressLink("Treasury", accounts.treasury),
  ];
}

function txLink(label: string, signature: string): VerifyLink {
  return { label, href: explorerTx(signature) };
}

function addressLink(label: string, address: PublicKey): VerifyLink {
  return { label, href: explorerAddress(address) };
}

async function fetchMachine(connection: ReturnType<typeof devnetConnection>, address: PublicKey) {
  const account = await connection.getAccountInfo(address, "confirmed");
  if (!account) {
    throw new Error("Machine account was not found");
  }

  return decodeMachine(Buffer.from(account.data));
}

async function fetchPendingPull(
  connection: ReturnType<typeof devnetConnection>,
  address: PublicKey,
) {
  const account = await connection.getAccountInfo(address, "confirmed");
  if (!account) {
    throw new Error("Pending pull account was not found");
  }

  return decodePendingPull(Buffer.from(account.data));
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function pickWeightedRewardId() {
  const totalWeight = REWARDS.reduce((total, reward) => total + reward.weight, 0);
  const random = Math.floor(Math.random() * totalWeight);
  let cursor = 0;

  for (let index = 0; index < REWARDS.length; index += 1) {
    cursor += REWARDS[index].weight;

    if (random < cursor) {
      return index;
    }
  }

  return REWARDS.length - 1;
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
