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
  Settings,
  Shuffle,
  Wallet,
  X,
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
  getLocalWalletBalance,
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

type QueuedResult = {
  pull: PendingPullAccount;
  coreAsset: CoreAssetAccount;
  assetOwner: PublicKey;
  machineAccount: MachineAccount;
  settlementSignature?: string;
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
  const [queuedResult, setQueuedResult] = useState<QueuedResult | null>(null);
  const [assetOwner, setAssetOwner] = useState<PublicKey | null>(null);
  const [steps, setSteps] = useState<VerifyStep[]>(initialSteps);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isAwaitingReveal, setIsAwaitingReveal] = useState(false);
  const [isCapsuleReady, setIsCapsuleReady] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isWalletCopied, setIsWalletCopied] = useState(false);
  const [simulatedRewardId, setSimulatedRewardId] = useState<number | null>(
    null,
  );
  const alignmentResolveRef = useRef<(() => void) | null>(null);
  const animationRunIdRef = useRef(0);
  const queuedResultRef = useRef<QueuedResult | null>(null);
  const capsuleReadyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
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
    void getLocalWalletBalance(connection, keypair.publicKey)
      .then((balance) => {
        if (!cancelled) {
          setWalletBalance(balance);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [connection]);

  const selectedReward = useMemo(() => {
    if (simulatedRewardId !== null) {
      return REWARDS[simulatedRewardId];
    }

    const rewardId = Number(coreAsset?.attributes.get("reward_id"));
    if (!Number.isInteger(rewardId) || rewardId < 0 || rewardId >= REWARDS.length) {
      return null;
    }

    return REWARDS[rewardId];
  }, [coreAsset, simulatedRewardId]);

  const initStep = steps.find((step) => step.id === "init") ?? initialSteps[0];
  const configStep =
    steps.find((step) => step.id === "config") ?? initialSteps[1];
  const requestStep =
    steps.find((step) => step.id === "request") ?? initialSteps[2];
  const settlementStep =
    steps.find((step) => step.id === "settlement") ?? initialSteps[3];
  const assetStep = steps.find((step) => step.id === "asset") ?? initialSteps[4];
  const isBusy = isRunning || isFunding || isSimulating || isAwaitingReveal;
  const showPostPullActions = Boolean(
    coreAsset && animationState === "revealed",
  );
  const resultStatus: StepStatus =
    assetStep.status === "done" || selectedReward
      ? "done"
      : queuedResult
        ? "active"
      : settlementStep.status === "error" || assetStep.status === "error"
        ? "error"
        : settlementStep.status === "active"
          ? "active"
          : "idle";
  const setupStatus: StepStatus =
    configStep.status === "done"
      ? "done"
      : initStep.status === "error" || configStep.status === "error"
        ? "error"
        : initStep.status === "active" || configStep.status === "active"
          ? "active"
          : initStep.status === "done"
            ? "active"
            : "idle";
  const setupDetail =
    configStep.status === "done"
      ? "Machine configured"
      : configStep.status === "active"
        ? configStep.detail
        : initStep.detail;
  const setupLink =
    getTransactionLink(configStep) ??
    getTransactionLink(initStep) ??
    getStepLink(configStep, "Machine") ??
    getStepLink(initStep, "Machine");
  const requestLink = getTransactionLink(requestStep);
  const callbackLink =
    getTransactionLink(settlementStep) ?? getTransactionLink(assetStep);
  const demoSteps: Array<{
    label: string;
    detail: string;
    status: StepStatus;
    link?: VerifyLink | null;
  }> = [
    {
      label: "Machine setup",
      detail: setupDetail,
      status: setupStatus,
      link: setupLink,
    },
    {
      label: "VRF request",
      detail: requestStep.detail,
      status: requestStep.status,
      link: requestLink,
    },
    {
      label: "Callback reward",
      detail: queuedResult
        ? "Randomness received. Open capsule."
        : coreAsset?.name ?? selectedReward?.name ?? settlementStep.detail,
      status: resultStatus,
      link: callbackLink,
    },
  ];

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

        onPoll(pull);
        await wait(3_000);
      }

      throw new Error("Timed out waiting for the VRF callback");
    },
    [connection, findSettlementSignature],
  );

  const runCapsuleDropAnimation = useCallback(async () => {
    const runId = animationRunIdRef.current + 1;
    animationRunIdRef.current = runId;
    capsuleReadyRef.current = false;
    setIsCapsuleReady(false);

    const isCurrentRun = () => animationRunIdRef.current === runId;
    const alignmentPromise = waitForMachineAlignment(alignmentResolveRef);

    setAnimationState("aligning");
    await alignmentPromise;
    if (!isCurrentRun()) {
      return false;
    }

    setAnimationState("turning");
    await wait(2_400);
    if (!isCurrentRun()) {
      return false;
    }

    setAnimationState("dropping");
    await wait(6_900);
    if (!isCurrentRun()) {
      return false;
    }

    capsuleReadyRef.current = true;
    setIsCapsuleReady(true);
    if (queuedResultRef.current) {
      setIsAwaitingReveal(true);
    }

    return true;
  }, []);

  const runDevnetPull = useCallback(async () => {
    if (isRunning || isFunding || isSimulating || isAwaitingReveal) {
      return;
    }

    setIsRunning(true);
    setFlowError(null);
    setAccounts(null);
    setMachineAccount(null);
    setPendingPull(null);
    setCoreAsset(null);
    setQueuedResult(null);
    setAssetOwner(null);
    setIsAwaitingReveal(false);
    setIsCapsuleReady(false);
    setSimulatedRewardId(null);
    setSteps(initialSteps);
    setCameraResetKey((value) => value + 1);
    queuedResultRef.current = null;
    capsuleReadyRef.current = false;

    try {
      const animationPromise = runCapsuleDropAnimation();
      const keypair = await prepareLocalWallet();
      const publicKey = keypair.publicKey;
      const setupAccounts = findGachaponAccounts(publicKey);
      const clientSeed = window.crypto.getRandomValues(new Uint8Array(1))[0];

      setAccounts(setupAccounts);
      updateStep("init", {
        status: "active",
        detail: `Checking ${shortKey(setupAccounts.machine)}`,
        links: accountLinks(setupAccounts, publicKey),
      });

      let activeMachine = await fetchMachineIfExists(
        connection,
        setupAccounts.machine,
      );
      if (activeMachine) {
        setMachineAccount(activeMachine);
        updateStep("init", {
          status: "done",
          detail: "Existing machine found",
          links: [
            addressLink("Machine", setupAccounts.machine),
            addressLink("Treasury", setupAccounts.treasury),
            addressLink("Update authority", setupAccounts.updateAuthority),
          ],
        });
      } else {
        updateStep("init", {
          status: "active",
          detail: `Creating ${shortKey(setupAccounts.machine)}`,
          links: accountLinks(setupAccounts, publicKey),
        });

        const initSignature = await sendLocalWalletTransaction(
          connection,
          keypair,
          buildInitInstruction(publicKey, setupAccounts),
        );
        activeMachine = await fetchMachine(connection, setupAccounts.machine);
        setMachineAccount(activeMachine);
        updateStep("init", {
          status: "done",
          detail: "Machine created",
          links: [
            txLink("Init tx", initSignature),
            addressLink("Machine", setupAccounts.machine),
            addressLink("Treasury", setupAccounts.treasury),
            addressLink("Update authority", setupAccounts.updateAuthority),
          ],
        });
      }

      if (isDemoMachineConfigured(activeMachine)) {
        updateStep("config", {
          status: "done",
          detail: `${activeMachine.totalWeight} total weight already uploaded`,
          links: [addressLink("Machine", setupAccounts.machine)],
        });
      } else {
        updateStep("config", {
          status: "active",
          detail: "Uploading placeholder templates",
          links: [addressLink("Machine", setupAccounts.machine)],
        });

        const configSignature = await sendLocalWalletTransaction(
          connection,
          keypair,
          buildUploadConfigInstruction(publicKey, setupAccounts),
        );
        activeMachine = await fetchMachine(connection, setupAccounts.machine);
        setMachineAccount(activeMachine);
        updateStep("config", {
          status: "done",
          detail: `${activeMachine.totalWeight} total weight`,
          links: [
            txLink("Config tx", configSignature),
            addressLink("Machine", setupAccounts.machine),
          ],
        });
      }

      const nextAccounts = await findNextAvailablePullAccounts(
        connection,
        publicKey,
        activeMachine,
      );
      setAccounts(nextAccounts);

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

      const queued: QueuedResult = {
        pull: settled.pull,
        coreAsset: settled.coreAsset,
        assetOwner: settled.assetAccount.owner,
        machineAccount: await fetchMachine(connection, nextAccounts.machine),
        settlementSignature: settled.settlementSignature,
      };
      queuedResultRef.current = queued;
      setQueuedResult(queued);
      if (capsuleReadyRef.current) {
        setIsAwaitingReveal(true);
      }

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
        status: "active",
        detail: "Reward sealed in capsule",
        links: [
          addressLink("Core asset", nextAccounts.asset),
        ],
      });
      await animationPromise;
    } catch (error) {
      animationRunIdRef.current += 1;
      alignmentResolveRef.current?.();
      alignmentResolveRef.current = null;
      capsuleReadyRef.current = false;
      queuedResultRef.current = null;
      setQueuedResult(null);
      setIsCapsuleReady(false);
      setIsAwaitingReveal(false);
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
    runCapsuleDropAnimation,
  ]);

  const runSimulatedPull = useCallback(async () => {
    if (isRunning || isFunding || isSimulating || isAwaitingReveal) {
      return;
    }

    setIsSimulating(true);
    setFlowError(null);
    setPendingPull(null);
    setCoreAsset(null);
    setQueuedResult(null);
    setAssetOwner(null);
    setIsAwaitingReveal(false);
    setIsCapsuleReady(false);
    setSteps(initialSteps);
    setSimulatedRewardId(null);
    setCameraResetKey((value) => value + 1);
    queuedResultRef.current = null;
    capsuleReadyRef.current = false;

    try {
      await runCapsuleDropAnimation();
      setIsAwaitingReveal(true);
    } finally {
      setIsSimulating(false);
    }
  }, [
    isAwaitingReveal,
    isFunding,
    isRunning,
    isSimulating,
    runCapsuleDropAnimation,
  ]);

  const handleMachineAligned = useCallback(() => {
    alignmentResolveRef.current?.();
    alignmentResolveRef.current = null;
  }, []);

  const handleCapsulePress = useCallback(() => {
    if (!isAwaitingReveal || animationState !== "dropping") {
      return;
    }

    if (queuedResult) {
      setPendingPull(queuedResult.pull);
      setCoreAsset(queuedResult.coreAsset);
      setAssetOwner(queuedResult.assetOwner);
      setMachineAccount(queuedResult.machineAccount);
      setQueuedResult(null);
      queuedResultRef.current = null;
      if (accounts) {
        updateStep("asset", {
          status: "done",
          detail: queuedResult.coreAsset.name,
          links: [
            addressLink("Core asset", accounts.asset),
            addressLink("Owner", queuedResult.coreAsset.owner),
            ...(queuedResult.coreAsset.updateAuthority
              ? [
                  addressLink(
                    "Update authority",
                    queuedResult.coreAsset.updateAuthority,
                  ),
                ]
              : []),
            addressLink("Core program", queuedResult.assetOwner),
          ],
        });
      }
    } else {
      setSimulatedRewardId(pickWeightedRewardId());
    }

    setIsAwaitingReveal(false);
    setAnimationState("revealed");
  }, [accounts, animationState, isAwaitingReveal, queuedResult]);

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

  const copyWalletAddress = useCallback(() => {
    if (!walletKey || !navigator.clipboard) {
      return;
    }

    void navigator.clipboard.writeText(walletKey.toString()).then(() => {
      setIsWalletCopied(true);
      window.setTimeout(() => setIsWalletCopied(false), 1_400);
    });
  }, [walletKey]);

  const resetSceneToSpin = useCallback(() => {
    animationRunIdRef.current += 1;
    alignmentResolveRef.current?.();
    alignmentResolveRef.current = null;
    capsuleReadyRef.current = false;
    setIsCapsuleReady(false);
    setIsAwaitingReveal(false);
    setAnimationState("idle");
    setCameraResetKey((value) => value + 1);
  }, []);

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
        <div className="demoHeader">
          <div className="titleBlock">
            <span className="eyebrow">MagicBlock VRF Demo</span>
            <h1>Magic Gachapon</h1>
            <p className="demoIntro">
              This demo demonstrates creating a gachapon machine that runs via
              MagicBlock VRF and mints a resulting Metaplex NFT based on the
              result.
            </p>
            <div className="demoLinkRow">
              <a
                href="https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/how-to-guide/quickstart"
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={13} />
                Learn about the MagicBlock VRF
              </a>
              <a
                href="https://github.com/magicblock-labs/magicblock-engine-examples"
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={13} />
                Fork this repo
              </a>
            </div>
          </div>
        </div>

        <div className="walletSummary">
          <div>
            <span>Local Wallet</span>
            <button
              className={
                isWalletCopied ? "walletCopyButton copied" : "walletCopyButton"
              }
              type="button"
              disabled={!walletKey}
              title={walletKey?.toString() ?? "Local wallet pending"}
              aria-label={
                walletKey ? "Copy local wallet address" : "Local wallet pending"
              }
              onClick={copyWalletAddress}
            >
              <strong>
                {walletKey
                  ? isWalletCopied
                    ? "Copied"
                    : shortKey(walletKey)
                  : "Pending"}
              </strong>
              {walletKey ? <Copy size={14} /> : null}
            </button>
            <small>{formatSolBalance(walletBalance)}</small>
          </div>
          <button
            className="secondaryButton"
            type="button"
            disabled={isBusy}
            onClick={handlePrepareLocalWallet}
          >
            {isFunding ? <Loader2 className="spinIcon" size={18} /> : <Wallet size={18} />}
            Fund
          </button>
        </div>

        {showPostPullActions ? (
          <div className="demoActionSplit">
            <button
              className="primaryButton demoPrimary"
              type="button"
              disabled={isBusy}
              onClick={runDevnetPull}
            >
              {isRunning ? (
                <Loader2 className="spinIcon" size={20} />
              ) : (
                <Play size={20} />
              )}
              Pull Again
            </button>
            <button
              className="secondaryButton sceneResetButton"
              type="button"
              disabled={isBusy}
              aria-label="Reset scene"
              title="Reset scene"
              onClick={resetSceneToSpin}
            >
              <RotateCcw size={22} />
            </button>
          </div>
        ) : (
          <button
            className="primaryButton demoPrimary"
            type="button"
            disabled={isBusy}
            onClick={runDevnetPull}
          >
            {isRunning ? (
              <Loader2 className="spinIcon" size={20} />
            ) : (
              <Play size={20} />
            )}
            Start VRF Pull
          </button>
        )}

        {flowError ? <p className="errorText">{flowError}</p> : null}

        <div className="demoFlow">
          {demoSteps.map((step, index) => {
            const className = `demoStep ${step.status}${step.link ? " linked" : ""}`;
            const content = (
              <>
                <div className="demoStepIndex">{index + 1}</div>
                <div>
                  <strong>
                    {step.label}
                    {step.link ? (
                      <ExternalLink className="demoStepLinkIcon" size={13} />
                    ) : null}
                  </strong>
                  <span>{step.detail}</span>
                </div>
              </>
            );

            return step.link ? (
              <a
                className={className}
                href={step.link.href}
                key={step.label}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${step.link.label}`}
              >
                {content}
              </a>
            ) : (
              <div className={className} key={step.label}>
                {content}
              </div>
            );
          })}
        </div>

        <div className={coreAsset || selectedReward ? "rewardReveal active" : "rewardReveal"}>
          <div>
            <span>Reward</span>
            <strong>{coreAsset?.name ?? selectedReward?.name ?? "Pending"}</strong>
          </div>
          <Gift size={34} />
        </div>

        {coreAsset ? (
          <div className="sectionBlock">
            <h2>Minted Asset</h2>
            <dl className="reportList">
              <TextRow label="Name" value={coreAsset.name} />
              <AccountRow label="NFT" value={accounts?.asset} compact />
            </dl>
          </div>
        ) : null}

        <div className="sectionBlock">
          <div className="sectionHeader">
            <h2>Capsule Odds</h2>
            <button
              className="miniIconButton"
              type="button"
              aria-label="Open details"
              onClick={() => setIsDetailsOpen(true)}
            >
              <Settings size={15} />
            </button>
          </div>
          <div className="rewardList">
            {REWARDS.map((reward, index) => {
              const mintedCount = machineAccount?.rewards[index]?.mintedCount ?? 0n;
              const active =
                (coreAsset?.attributes.get("reward_id") === String(index)) ||
                simulatedRewardId === index;

              return (
                <div className={active ? "rewardRow active" : "rewardRow"} key={reward.name}>
                  <div>
                    <strong>{reward.name}</strong>
                  </div>
                  <span>{reward.weight}%</span>
                  <span>{mintedCount.toString()}</span>
                </div>
              );
            })}
          </div>
        </div>

        <button
          className="secondaryButton detailsButton"
          type="button"
          onClick={() => setIsDetailsOpen(true)}
        >
          <Settings size={18} />
          Details
        </button>
      </aside>

      {isDetailsOpen ? (
        <div
          className="detailsOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="Demo details"
        >
          <div className="detailsPanel">
            <div className="detailsHeader">
              <div>
                <span className="eyebrow">Demo Details</span>
                <h2>Verification</h2>
              </div>
              <button
                className="miniIconButton"
                type="button"
                aria-label="Close details"
                onClick={() => setIsDetailsOpen(false)}
              >
                <X size={15} />
              </button>
            </div>

            <div className="detailsGrid">
              <div className="sectionBlock">
                <h2>Transaction Flow</h2>
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
                              <ExplorerAnchor
                                key={`${step.id}-${link.label}`}
                                link={link}
                              />
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
                <h2>Links</h2>
                <div className="linkGrid staticLinks">
                  {staticLinks.map((link) => (
                    <ExplorerAnchor key={link.label} link={link} />
                  ))}
                </div>
              </div>

              <div className="sectionBlock">
                <h2>Preview</h2>
                <div className="detailsActions">
                  <button
                    className="simulateButton"
                    type="button"
                    disabled={isBusy}
                    onClick={runSimulatedPull}
                  >
                    {isSimulating ? (
                      <Loader2 className="spinIcon" size={18} />
                    ) : (
                      <Shuffle size={18} />
                    )}
                    Simulate Pull
                  </button>
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => setRefreshKey((value) => value + 1)}
                  >
                    <RefreshCw size={18} />
                    Refresh
                  </button>
                </div>
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
                        disabled={isBusy}
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
                <div
                  className="axisControl"
                  role="radiogroup"
                  aria-label="Knob rotation axis"
                >
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

              <div className="sectionBlock detailWide">
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

              <div className="sectionBlock detailWide">
                <h2>Model Objects</h2>
                <dl className="reportList">
                  {reportRows.map(([label, value]) => (
                    <TextRow key={label} label={label} value={value} />
                  ))}
                </dl>
                {report.error ? <p className="errorText">{report.error}</p> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
  compact = false,
  label,
  value,
}: {
  compact?: boolean;
  label: string;
  value: PublicKey | null | undefined;
}) {
  const displayValue = value ? (compact ? shortKey(value) : value.toBase58()) : null;

  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value ? (
          <a href={explorerAddress(value)} target="_blank" rel="noreferrer">
            {displayValue}
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

function getTransactionLink(step: VerifyStep) {
  return (
    step.links.find((link) => link.label.toLowerCase().includes("tx")) ?? null
  );
}

function getStepLink(step: VerifyStep, label: string) {
  return step.links.find((link) => link.label === label) ?? null;
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

async function fetchMachineIfExists(
  connection: ReturnType<typeof devnetConnection>,
  address: PublicKey,
) {
  const account = await connection.getAccountInfo(address, "confirmed");
  if (!account) {
    return null;
  }

  return decodeMachine(Buffer.from(account.data));
}

function isDemoMachineConfigured(machine: MachineAccount) {
  const expectedTotalWeight = REWARDS.reduce(
    (total, reward) => total + reward.weight,
    0,
  );

  return (
    machine.totalWeight === expectedTotalWeight &&
    REWARDS.every((reward, index) => {
      const configuredReward = machine.rewards[index];

      return (
        configuredReward?.rewardId === index &&
        configuredReward.weight === reward.weight &&
        configuredReward.name === reward.name &&
        configuredReward.uri === reward.uri
      );
    })
  );
}

async function findNextAvailablePullAccounts(
  connection: ReturnType<typeof devnetConnection>,
  player: PublicKey,
  machine: MachineAccount,
) {
  let pullId = machine.pullCount + 1n;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const accounts = findGachaponAccounts(player, machine.machineId, pullId);
    const [pendingPull, asset] = await connection.getMultipleAccountsInfo(
      [accounts.pendingPull, accounts.asset],
      "confirmed",
    );

    if (!pendingPull && !asset) {
      return accounts;
    }

    pullId += 1n;
  }

  throw new Error("Could not find an unused pull account");
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
