"use client";

import {
  ContactShadows,
  Environment,
  OrbitControls,
  useGLTF,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import React, {
  Component,
  Suspense,
  useMemo,
  useRef,
  useEffect,
} from "react";
import * as THREE from "three";

export type AnimationState =
  | "idle"
  | "aligning"
  | "turning"
  | "shaking"
  | "dropping"
  | "revealed";

export type KnobAxis = "x" | "y" | "z";

export type DropPathPoint = {
  x: number;
  y: number;
  z: number;
};

export type DropPathSettings = {
  inside: DropPathPoint;
  chute: DropPathPoint;
  curve: DropPathPoint;
  front: DropPathPoint;
};

export type ModelReport = {
  source: "glb" | "fallback";
  url: string;
  available: boolean;
  machineName: string | null;
  knobName: string | null;
  ballName: string | null;
  error: string | null;
};

const MODEL_URL = "/models/gachapon.glb";
const TAU = Math.PI * 2;
const DROP_CHUTE_EXIT_PROGRESS = 0.2;
const DROP_FIRST_LEG_SECONDS = 2.2;
const DROP_SECOND_LEG_SECONDS = 4.08;
const DROP_CHUTE_HOLD_SECONDS = 0.5;
const IDLE_TURN_SECONDS = 18;
const ALIGN_TURN_SECONDS = 3;
const KNOB_TURN_SECONDS = 2.75;
const CAMERA_RESET_SECONDS = 1;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 1.4, 5.2);
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);

export const defaultDropPathSettings: DropPathSettings = {
  inside: { x: -0.2, y: -0.3, z: -0.24 },
  chute: { x: -0.3, y: -1.58, z: 0.72 },
  curve: { x: -0.3, y: -1.32, z: 1.34 },
  front: { x: 0.03, y: 1.2, z: 3 },
};

type SceneProps = {
  animationState: AnimationState;
  knobAxis: KnobAxis;
  dropPath: DropPathSettings;
  refreshKey: number;
  cameraResetKey: number;
  onReport: (report: ModelReport) => void;
  onMachineAligned: () => void;
};

type ModelBoundaryProps = {
  children: React.ReactNode;
  fallback: React.ReactNode;
  onError: (error: string) => void;
};

type ModelBoundaryState = {
  hasError: boolean;
};

class ModelBoundary extends Component<ModelBoundaryProps, ModelBoundaryState> {
  state: ModelBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error.message);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

export function GachaponScene({
  animationState,
  knobAxis,
  dropPath,
  refreshKey,
  cameraResetKey,
  onReport,
  onMachineAligned,
}: SceneProps) {
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null);
  const fallback = (
    <ProceduralGachapon
      animationState={animationState}
      knobAxis={knobAxis}
      dropPath={dropPath}
      onMachineAligned={onMachineAligned}
    />
  );
  const modelUrl = `${MODEL_URL}?v=${refreshKey}`;

  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: [0, 1.4, 5.2], fov: 38 }}
      gl={{ antialias: true, alpha: false }}
    >
      <CameraResetter resetKey={cameraResetKey} controlsRef={controlsRef} />
      <color attach="background" args={["#f7efe5"]} />
      <ambientLight intensity={0.7} />
      <directionalLight
        castShadow
        intensity={2.4}
        position={[3.5, 5, 4]}
        shadow-mapSize={[1024, 1024]}
      />
      <spotLight
        intensity={1.8}
        position={[-4, 3, 3]}
        angle={0.45}
        penumbra={0.7}
      />
      <Suspense fallback={fallback}>
        <ModelBoundary
          key={refreshKey}
          fallback={fallback}
          onError={(error) =>
            onReport({
              source: "fallback",
              url: MODEL_URL,
              available: false,
              machineName: "ProceduralMachine",
              knobName: "ProceduralKnob",
              ballName: "ProceduralBall",
              error,
            })
          }
        >
          <LoadedGachapon
            animationState={animationState}
            knobAxis={knobAxis}
            dropPath={dropPath}
            modelUrl={modelUrl}
            onReport={onReport}
            onMachineAligned={onMachineAligned}
          />
        </ModelBoundary>
      </Suspense>
      <ContactShadows
        opacity={0.35}
        scale={7}
        blur={2.2}
        far={4}
        position={[0, -1.82, 0]}
      />
      <Environment preset="city" />
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        minDistance={2.4}
        maxDistance={8}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}

function CameraResetter({
  resetKey,
  controlsRef,
}: {
  resetKey: number;
  controlsRef: React.RefObject<React.ElementRef<typeof OrbitControls> | null>;
}) {
  const { camera } = useThree();
  const resetRef = useRef({
    active: false,
    elapsed: 0,
    startPosition: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
  });

  useEffect(() => {
    if (resetKey === 0) {
      return;
    }

    resetRef.current.active = true;
    resetRef.current.elapsed = 0;
    resetRef.current.startPosition.copy(camera.position);
    resetRef.current.startTarget.copy(
      controlsRef.current?.target ?? DEFAULT_CAMERA_TARGET,
    );
  }, [camera, controlsRef, resetKey]);

  useFrame((_, delta) => {
    const reset = resetRef.current;

    if (!reset.active) {
      return;
    }

    reset.elapsed += delta;
    const progress = Math.min(reset.elapsed / CAMERA_RESET_SECONDS, 1);
    const easedProgress = easeInOutCubic(progress);

    camera.position
      .copy(reset.startPosition)
      .lerp(DEFAULT_CAMERA_POSITION, easedProgress);
    camera.lookAt(DEFAULT_CAMERA_TARGET);

    if (controlsRef.current) {
      controlsRef.current.target
        .copy(reset.startTarget)
        .lerp(DEFAULT_CAMERA_TARGET, easedProgress);
      controlsRef.current.update();
    }

    if (progress >= 1) {
      reset.active = false;
    }
  });

  return null;
}

function LoadedGachapon({
  animationState,
  knobAxis,
  dropPath,
  modelUrl,
  onReport,
  onMachineAligned,
}: {
  animationState: AnimationState;
  knobAxis: KnobAxis;
  dropPath: DropPathSettings;
  modelUrl: string;
  onReport: (report: ModelReport) => void;
  onMachineAligned: () => void;
}) {
  const gltf = useGLTF(modelUrl);
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const rootRef = useRef<THREE.Group>(null);
  const knobRef = useRef<THREE.Object3D | null>(null);
  const ballRef = useRef<THREE.Object3D | null>(null);
  const capsuleRef = useRef<THREE.Group>(null);
  const capsuleTopRef = useRef<THREE.Group>(null);
  const capsuleBottomRef = useRef<THREE.Group>(null);
  const prizeRef = useRef<THREE.Mesh>(null);
  const stageRef = useRef(animationState);
  const stageTimeRef = useRef(0);
  const alignmentNotifiedRef = useRef(false);
  const baseRef = useRef({
    rootRotation: new THREE.Euler(),
    rootPosition: new THREE.Vector3(),
    knobRotation: new THREE.Euler(),
    knobPosition: new THREE.Vector3(),
    knobCenterOffset: new THREE.Vector3(),
    ballPosition: new THREE.Vector3(),
    ballRotation: new THREE.Euler(),
  });

  useEffect(() => {
    const machine = findNamedObject(model, ["Machine", "machine", "body"]);
    const knob = findNamedObject(model, ["Knob", "knob", "handle"]);
    const ball = findNamedObject(model, ["Ball", "ball", "capsule"]);

    knobRef.current = knob;
    ballRef.current = ball;

    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    normalizeModel(model);

    if (rootRef.current) {
      baseRef.current.rootRotation.copy(rootRef.current.rotation);
      baseRef.current.rootPosition.copy(rootRef.current.position);
    }

    if (knob) {
      baseRef.current.knobRotation.copy(knob.rotation);
      baseRef.current.knobPosition.copy(knob.position);
      baseRef.current.knobCenterOffset.copy(getObjectCenterOffset(knob));
    }

    if (ball) {
      baseRef.current.ballPosition.copy(ball.position);
      baseRef.current.ballRotation.copy(ball.rotation);
    }

    onReport({
      source: "glb",
      url: MODEL_URL,
      available: true,
      machineName: machine?.name ?? null,
      knobName: knob?.name ?? null,
      ballName: ball?.name ?? null,
      error: null,
    });
  }, [model, onReport]);

  useFrame((state, delta) => {
    const stageTime = updateStageClock(animationState, stageRef, stageTimeRef, delta);
    const aligned = animateRoot(
      rootRef.current,
      baseRef.current.rootRotation,
      baseRef.current.rootPosition,
      animationState,
      stageTime,
      state.clock.elapsedTime,
    );
    notifyMachineAligned(
      aligned,
      animationState,
      alignmentNotifiedRef,
      onMachineAligned,
    );
    animateKnob(
      knobRef.current,
      baseRef.current.knobRotation,
      baseRef.current.knobPosition,
      baseRef.current.knobCenterOffset,
      animationState,
      stageTime,
      knobAxis,
    );
    animateModelBall(
      ballRef.current,
      baseRef.current.ballPosition,
      baseRef.current.ballRotation,
      animationState,
      stageTime,
      state.clock.elapsedTime,
    );
    animateCapsule(
      capsuleRef.current,
      capsuleTopRef.current,
      capsuleBottomRef.current,
      prizeRef.current,
      animationState,
      stageTime,
      dropPath,
    );
  });

  return (
    <group ref={rootRef} position={[0, -0.2, 0]}>
      <primitive object={model} />
      <Capsule ref={capsuleRef} topRef={capsuleTopRef} bottomRef={capsuleBottomRef} prizeRef={prizeRef} />
    </group>
  );
}

function ProceduralGachapon({
  animationState,
  knobAxis,
  dropPath,
  onMachineAligned,
}: {
  animationState: AnimationState;
  knobAxis: KnobAxis;
  dropPath: DropPathSettings;
  onMachineAligned: () => void;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const knobRef = useRef<THREE.Group>(null);
  const ballsRef = useRef<THREE.Group>(null);
  const capsuleRef = useRef<THREE.Group>(null);
  const capsuleTopRef = useRef<THREE.Group>(null);
  const capsuleBottomRef = useRef<THREE.Group>(null);
  const prizeRef = useRef<THREE.Mesh>(null);
  const stageRef = useRef(animationState);
  const stageTimeRef = useRef(0);
  const alignmentNotifiedRef = useRef(false);
  const rootBasePosition = useMemo(() => new THREE.Vector3(0, -0.05, 0), []);
  const rootBaseRotation = useMemo(() => new THREE.Euler(0, 0, 0), []);
  const knobBaseRotation = useMemo(() => new THREE.Euler(0, 0, 0), []);
  const knobBasePosition = useMemo(() => new THREE.Vector3(0, -0.5, 0.73), []);
  const knobCenterOffset = useMemo(() => new THREE.Vector3(0, 0, 0), []);

  const balls = useMemo(
    () => [
      { position: [-0.45, 0.28, 0.08], color: "#f54d5e" },
      { position: [-0.18, 0.53, -0.16], color: "#ffce4a" },
      { position: [0.2, 0.42, 0.13], color: "#38b6ff" },
      { position: [0.44, 0.22, -0.08], color: "#59d77d" },
      { position: [-0.05, 0.12, 0.2], color: "#ffffff" },
      { position: [0.13, 0.72, -0.02], color: "#f47bd5" },
    ],
    [],
  );

  useFrame((state, delta) => {
    const stageTime = updateStageClock(animationState, stageRef, stageTimeRef, delta);
    const aligned = animateRoot(
      rootRef.current,
      rootBaseRotation,
      rootBasePosition,
      animationState,
      stageTime,
      state.clock.elapsedTime,
    );
    notifyMachineAligned(
      aligned,
      animationState,
      alignmentNotifiedRef,
      onMachineAligned,
    );
    animateKnob(
      knobRef.current,
      knobBaseRotation,
      knobBasePosition,
      knobCenterOffset,
      animationState,
      stageTime,
      knobAxis,
    );

    if (ballsRef.current) {
      ballsRef.current.rotation.y = THREE.MathUtils.lerp(
        ballsRef.current.rotation.y,
        0,
        0.08,
      );
      ballsRef.current.position.x = THREE.MathUtils.lerp(
        ballsRef.current.position.x,
        0,
        0.08,
      );
    }

    animateCapsule(
      capsuleRef.current,
      capsuleTopRef.current,
      capsuleBottomRef.current,
      prizeRef.current,
      animationState,
      stageTime,
      dropPath,
    );
  });

  return (
    <group ref={rootRef} position={[0, -0.05, 0]}>
      <mesh castShadow receiveShadow position={[0, -0.85, 0]} scale={[1.18, 1, 0.78]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#d83246" roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, -1.36, 0.05]} scale={[1.45, 0.35, 0.95]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#1f2733" roughness={0.48} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, -0.5, 0.61]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.28, 0.28, 0.18, 36]} />
        <meshStandardMaterial color="#f4b942" roughness={0.32} metalness={0.2} />
      </mesh>
      <group ref={knobRef} position={[0, -0.5, 0.73]}>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 0.16, 36]} />
          <meshStandardMaterial color="#f9dc70" roughness={0.28} metalness={0.25} />
        </mesh>
        <mesh castShadow position={[0.18, 0, 0.02]} scale={[0.22, 0.08, 0.08]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ffffff" roughness={0.35} />
        </mesh>
      </group>
      <mesh castShadow receiveShadow position={[0, -1.0, 0.78]} rotation={[0, 0, -0.2]}>
        <boxGeometry args={[0.56, 0.22, 0.28]} />
        <meshStandardMaterial color="#f7f0e8" roughness={0.42} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.38, 0]} scale={[0.98, 0.98, 0.98]}>
        <sphereGeometry args={[0.9, 48, 32]} />
        <meshPhysicalMaterial
          color="#bfeaff"
          transmission={0.35}
          transparent
          opacity={0.34}
          roughness={0.08}
          metalness={0}
          thickness={0.45}
        />
      </mesh>
      <group ref={ballsRef}>
        {balls.map((ball, index) => (
          <mesh
            key={index}
            castShadow
            position={ball.position as [number, number, number]}
          >
            <sphereGeometry args={[0.17, 32, 20]} />
            <meshStandardMaterial color={ball.color} roughness={0.34} />
          </mesh>
        ))}
      </group>
      <Capsule ref={capsuleRef} topRef={capsuleTopRef} bottomRef={capsuleBottomRef} prizeRef={prizeRef} />
    </group>
  );
}

const Capsule = React.forwardRef<
  THREE.Group,
  {
    topRef: React.RefObject<THREE.Group | null>;
    bottomRef: React.RefObject<THREE.Group | null>;
    prizeRef: React.RefObject<THREE.Mesh | null>;
  }
>(function Capsule({ topRef, bottomRef, prizeRef }, ref) {
  return (
    <group ref={ref} visible={false}>
      <group ref={topRef}>
        <mesh castShadow receiveShadow position={[0, -0.004, 0]}>
          <sphereGeometry args={[0.24, 36, 18, 0, TAU, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#93d7ff" roughness={0.28} metalness={0.03} />
        </mesh>
      </group>
      <group ref={bottomRef}>
        <mesh castShadow receiveShadow position={[0, 0.004, 0]}>
          <sphereGeometry args={[0.24, 36, 18, 0, TAU, Math.PI / 2, Math.PI / 2]} />
          <meshStandardMaterial color="#4ab0ee" roughness={0.34} metalness={0.02} />
        </mesh>
      </group>
      <mesh ref={prizeRef} castShadow visible={false} position={[0, 0, 0]}>
        <boxGeometry args={[0.16, 0.16, 0.16]} />
        <meshStandardMaterial color="#ffce4a" roughness={0.22} metalness={0.08} />
      </mesh>
    </group>
  );
});

function findNamedObject(scene: THREE.Object3D, candidates: string[]) {
  const exact = candidates
    .map((name) => scene.getObjectByName(name))
    .find(Boolean);

  if (exact) {
    return exact;
  }

  let partial: THREE.Object3D | null = null;
  const lowered = candidates.map((name) => name.toLowerCase());

  scene.traverse((object) => {
    if (partial) {
      return;
    }

    const objectName = object.name.toLowerCase();

    if (lowered.some((name) => objectName.includes(name))) {
      partial = object;
    }
  });

  return partial;
}

function getObjectCenterOffset(object: THREE.Object3D) {
  object.updateWorldMatrix(true, true);

  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const inverseWorld = new THREE.Matrix4().copy(object.matrixWorld).invert();

  return center.applyMatrix4(inverseWorld);
}

function normalizeModel(model: THREE.Object3D) {
  if (model.userData.gachaponNormalized) {
    return;
  }

  const box = new THREE.Box3();
  let hasMesh = false;

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const childBox = new THREE.Box3().setFromObject(child);

    if (!hasMesh) {
      box.copy(childBox);
      hasMesh = true;
      return;
    }

    box.union(childBox);
  });

  if (!hasMesh) {
    return;
  }

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);

  if (maxDimension <= 0) {
    return;
  }

  const scale = 2.7 / maxDimension;
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -center.y * scale - 0.05, -center.z * scale);
  model.userData.gachaponNormalized = true;
}

function updateStageClock(
  animationState: AnimationState,
  stageRef: React.MutableRefObject<AnimationState>,
  stageTimeRef: React.MutableRefObject<number>,
  delta: number,
) {
  if (stageRef.current !== animationState) {
    stageRef.current = animationState;
    stageTimeRef.current = 0;
    return 0;
  }

  stageTimeRef.current += delta;
  return stageTimeRef.current;
}

function animateRoot(
  root: THREE.Object3D | null,
  baseRotation: THREE.Euler,
  basePosition: THREE.Vector3,
  animationState: AnimationState,
  stageTime: number,
  elapsedTime: number,
) {
  if (!root) {
    return false;
  }

  const shake = animationState === "shaking";
  const idleSpin =
    animationState === "idle" ? stageTime * (TAU / IDLE_TURN_SECONDS) : 0;
  const aligned =
    animationState === "aligning"
      ? alignRootToFront(root, baseRotation.y, stageTime)
      : false;

  root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, baseRotation.x, 0.1);
  if (animationState === "idle") {
    root.userData.alignToFront = null;
    root.rotation.y = baseRotation.y + idleSpin;
  } else if (animationState !== "aligning") {
    root.userData.alignToFront = null;
    root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, baseRotation.y, 0.08);
  }
  root.rotation.z = shake
    ? baseRotation.z + Math.sin(elapsedTime * 18) * 0.018
    : THREE.MathUtils.lerp(root.rotation.z, baseRotation.z, 0.1);
  root.position.x = shake
    ? basePosition.x + Math.sin(elapsedTime * 24) * 0.012
    : THREE.MathUtils.lerp(root.position.x, basePosition.x, 0.1);
  root.position.y = shake
    ? basePosition.y + Math.cos(stageTime * 18) * 0.009
    : THREE.MathUtils.lerp(root.position.y, basePosition.y, 0.1);
  root.position.z = THREE.MathUtils.lerp(root.position.z, basePosition.z, 0.1);

  return aligned;
}

function alignRootToFront(
  root: THREE.Object3D,
  baseRotationY: number,
  stageTime: number,
) {
  const data = getAlignmentData(root, baseRotationY);

  if (data.duration <= 0) {
    root.rotation.y = baseRotationY;
    return true;
  }

  const progress = Math.min(stageTime / data.duration, 1);
  root.rotation.y = THREE.MathUtils.lerp(
    data.startY,
    data.targetY,
    easeInOutCubic(progress),
  );

  if (progress >= 1) {
    root.rotation.y = baseRotationY;
    return true;
  }

  return false;
}

function getAlignmentData(root: THREE.Object3D, baseRotationY: number) {
  const existing = root.userData.alignToFront as
    | { startY: number; targetY: number; duration: number }
    | null
    | undefined;

  if (existing) {
    return existing;
  }

  const startY = root.rotation.y;
  const offset = positiveModulo(startY - baseRotationY, TAU);
  const remaining =
    offset < 0.02 || TAU - offset < 0.02 ? TAU : TAU - offset;
  const duration = remaining / (TAU / ALIGN_TURN_SECONDS);
  const data = {
    startY,
    targetY: startY + remaining,
    duration,
  };

  root.userData.alignToFront = data;
  return data;
}

function notifyMachineAligned(
  aligned: boolean,
  animationState: AnimationState,
  notifiedRef: React.MutableRefObject<boolean>,
  onMachineAligned: () => void,
) {
  if (animationState !== "aligning") {
    notifiedRef.current = false;
    return;
  }

  if (!aligned || notifiedRef.current) {
    return;
  }

  notifiedRef.current = true;
  onMachineAligned();
}

function animateKnob(
  knob: THREE.Object3D | null,
  baseRotation: THREE.Euler,
  basePosition: THREE.Vector3,
  centerOffset: THREE.Vector3,
  animationState: AnimationState,
  stageTime: number,
  knobAxis: KnobAxis,
) {
  if (!knob) {
    return;
  }

  knob.rotation.copy(baseRotation);
  knob.position.copy(basePosition);

  const progress =
    animationState === "turning"
      ? easeOutCubic(Math.min(stageTime / KNOB_TURN_SECONDS, 1))
      : animationState === "shaking" ||
          animationState === "dropping" ||
          animationState === "revealed"
        ? 1
        : 0;

  const angle = progress * TAU * 0.72;
  const baseCenter = centerOffset.clone().applyEuler(baseRotation).add(basePosition);

  knob.rotation[knobAxis] += angle;

  const rotatedCenter = centerOffset.clone().applyEuler(knob.rotation).add(basePosition);
  knob.position.copy(basePosition).add(baseCenter.sub(rotatedCenter));
}

function animateModelBall(
  ball: THREE.Object3D | null,
  basePosition: THREE.Vector3,
  baseRotation: THREE.Euler,
  animationState: AnimationState,
  stageTime: number,
  elapsedTime: number,
) {
  if (!ball) {
    return;
  }

  ball.visible = true;
  ball.position.copy(basePosition);
  ball.rotation.copy(baseRotation);

  if (animationState === "revealed") {
    ball.position.x += Math.sin(stageTime * 7) * 0.006;
    ball.position.y += Math.cos(stageTime * 8) * 0.004;
  }
}

function animateCapsule(
  capsule: THREE.Group | null,
  top: THREE.Group | null,
  bottom: THREE.Group | null,
  prize: THREE.Mesh | null,
  animationState: AnimationState,
  stageTime: number,
  dropPath: DropPathSettings,
) {
  if (!capsule || !top || !bottom || !prize) {
    return;
  }

  const active =
    animationState === "dropping" ||
    animationState === "shaking" ||
    animationState === "revealed";
  prize.visible = animationState === "revealed";

  if (!active) {
    capsule.visible = false;
    return;
  }

  const pathProgress =
    animationState === "revealed" || animationState === "shaking"
      ? 1
      : getDropProgress(stageTime);
  const pathPosition = getCapsulePathPosition(pathProgress, dropPath);
  const frontShake =
    animationState === "shaking" ||
    animationState === "revealed" ||
    pathProgress > 0.58;
  const shakeStrength =
    animationState === "revealed"
      ? 0.012
      : frontShake
        ? Math.min((pathProgress - 0.58) / 0.22, 1)
        : 0;

  capsule.visible = true;
  capsule.position.copy(pathPosition);
  capsule.position.x += Math.sin(stageTime * 3) * 0.035 * shakeStrength;
  capsule.position.y += Math.cos(stageTime * 3.5) * 0.022 * shakeStrength;
  capsule.rotation.set(0, 0, 0);
  capsule.rotation.x =
    THREE.MathUtils.lerp(-0.15, 0.05, pathProgress) + pathProgress * TAU * 1.45;
  capsule.rotation.y = Math.sin(stageTime * 2) * 0.08 * shakeStrength;
  capsule.rotation.z =
    THREE.MathUtils.lerp(0.18, -0.08, pathProgress) +
    Math.sin(stageTime * 3) * 0.12 * shakeStrength;
  capsule.scale.setScalar(0.52 + pathProgress * 0.42);

  top.position.set(0, 0, 0);
  bottom.position.set(0, 0, 0);
  top.rotation.set(0, 0, 0);
  bottom.rotation.set(0, 0, 0);
  prize.position.set(0, 0, 0);
  prize.rotation.set(stageTime * 0.9, stageTime * 1.1, 0);
  prize.scale.setScalar(0.001);

  if (animationState !== "revealed") {
    return;
  }

  const openProgress = easeOutCubic(Math.min(stageTime / 1.3, 1));

  top.position.set(-0.1 * openProgress, 0.22 * openProgress, 0);
  bottom.position.set(0.08 * openProgress, -0.12 * openProgress, 0);
  top.rotation.z = 0.72 * openProgress;
  top.rotation.x = -0.35 * openProgress;
  bottom.rotation.z = -0.46 * openProgress;
  bottom.rotation.x = 0.22 * openProgress;
  prize.visible = true;
  prize.position.y = 0.1 * openProgress;
  prize.scale.setScalar(0.001 + openProgress * 1.15);
}

function getCapsulePathPosition(progress: number, dropPath: DropPathSettings) {
  const start = pointToVector(dropPath.inside);
  const chute = pointToVector(dropPath.chute);
  const curve = pointToVector(dropPath.curve);
  const front = pointToVector(dropPath.front);

  return cubicBezier(start, chute, curve, front, progress);
}

function pointToVector(point: DropPathPoint) {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function getDropProgress(stageTime: number) {
  if (stageTime < DROP_FIRST_LEG_SECONDS) {
    const progress = easeOutCubic(
      Math.min(stageTime / DROP_FIRST_LEG_SECONDS, 1),
    );

    return progress * DROP_CHUTE_EXIT_PROGRESS;
  }

  if (stageTime < DROP_FIRST_LEG_SECONDS + DROP_CHUTE_HOLD_SECONDS) {
    return DROP_CHUTE_EXIT_PROGRESS;
  }

  const secondLegTime =
    stageTime - DROP_FIRST_LEG_SECONDS - DROP_CHUTE_HOLD_SECONDS;
  const progress = easeInOutCubic(
    Math.min(secondLegTime / DROP_SECOND_LEG_SECONDS, 1),
  );

  return (
    DROP_CHUTE_EXIT_PROGRESS +
    progress * (1 - DROP_CHUTE_EXIT_PROGRESS)
  );
}

function cubicBezier(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
  t: number,
) {
  const oneMinusT = 1 - t;

  return new THREE.Vector3(
    oneMinusT ** 3 * a.x +
      3 * oneMinusT ** 2 * t * b.x +
      3 * oneMinusT * t ** 2 * c.x +
      t ** 3 * d.x,
    oneMinusT ** 3 * a.y +
      3 * oneMinusT ** 2 * t * b.y +
      3 * oneMinusT * t ** 2 * c.y +
      t ** 3 * d.y,
    oneMinusT ** 3 * a.z +
      3 * oneMinusT ** 2 * t * b.z +
      3 * oneMinusT * t ** 2 * c.z +
      t ** 3 * d.z,
  );
}

function axisVector(axis: KnobAxis) {
  if (axis === "x") {
    return new THREE.Vector3(1, 0, 0);
  }

  if (axis === "y") {
    return new THREE.Vector3(0, 1, 0);
  }

  return new THREE.Vector3(0, 0, 1);
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}
