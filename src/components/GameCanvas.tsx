"use client";

import { useEffect, useRef, useCallback, useState } from "react";

// 게임 설정 변수들
const GAME_CONFIG = {
  CANVAS_WIDTH: 400,
  CANVAS_HEIGHT: 600,
  COLORS: ["#ff4757", "#2ed573", "#ffa502", "#3742fa", "#ff6b9d"],

  // 플레이어 설정
  PLAYER: {
    X: 100,
    Y: 300,
    RADIUS: 20,
    GRAVITY: 0.6,
    JUMP_POWER: -12,
  },

  // 장애물 설정
  OBSTACLE: {
    WIDTH: 30,
    HEIGHT: 60,
    BASE_SPEED: 3,
    SPAWN_INTERVAL: 70,
  },

  // 파워업 설정
  POWERUP: {
    SPAWN_CHANCE: 0.15, // 15% 확률
    DURATION: 300, // 5초 (60fps 기준)
    LIFE_SPAWN_CHANCE: 0.05, // 5% 확률 (생명력 아이템)
  },

  // 게임 진행 설정
  COLOR_CHANGE_INTERVAL: 180,
  SPEED_INCREASE_RATE: 0.08,
  MAX_SPEED_MULTIPLIER: 2.5,
  COMBO_TIMEOUT: 600, // 10초 (60fps 기준)
};

interface Player {
  x: number;
  y: number;
  radius: number;
  vy: number;
  color: string;
  isJumping: boolean;
  jumpCount: number;
  shield: number;
  jumpBoost: number;
  lives: number;
  invincible: number;
}

interface Obstacle {
  x: number;
  color: string;
  passed: boolean;
  type: "normal" | "bonus" | "tall";
  colorChanged?: boolean;
}

interface PowerUp {
  x: number;
  y: number;
  type: "shield" | "bonus" | "life" | "jumpBoost";
  collected: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface GameState {
  player: Player;
  obstacles: Obstacle[];
  powerUps: PowerUp[];
  particles: Particle[];
  score: number;
  combo: number;
  comboTimer: number;
  bestScore: number;
  level: number;
  isGameOver: boolean;
  colorChangeOnNextObstacle: boolean;
  backgroundOffset: number;
  gameStarted: boolean;
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const gameStateRef = useRef<GameState | null>(null);
  const timersRef = useRef({ spawn: 0, colorChange: 0, powerUpSpawn: 0 });
  const [isClient, setIsClient] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // 클라이언트 사이드에서만 실행되도록 보장
  useEffect(() => {
    setIsClient(true);
    if (typeof window !== "undefined") {
      setIsMobile(window.innerWidth <= 768);

      const handleResize = () => {
        setIsMobile(window.innerWidth <= 768);
      };

      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);

  // 로컬 스토리지에서 최고 점수 불러오기
  const getBestScore = useCallback((): number => {
    if (typeof window !== "undefined" && isClient) {
      return parseInt(localStorage.getItem("colorRunBestScore") || "0");
    }
    return 0;
  }, [isClient]);

  // 최고 점수 저장
  const saveBestScore = useCallback(
    (score: number) => {
      if (typeof window !== "undefined" && isClient) {
        localStorage.setItem("colorRunBestScore", score.toString());
      }
    },
    [isClient]
  );

  // 초기 게임 상태 생성
  const createInitialGameState = useCallback(
    (): GameState => ({
      player: {
        x: GAME_CONFIG.PLAYER.X,
        y: GAME_CONFIG.PLAYER.Y,
        radius: GAME_CONFIG.PLAYER.RADIUS,
        vy: 0,
        color: GAME_CONFIG.COLORS[0],
        isJumping: false,
        jumpCount: 0,
        shield: 0,
        jumpBoost: 0,
        lives: 3,
        invincible: 0,
      },
      obstacles: [],
      powerUps: [],
      particles: [],
      score: 0,
      combo: 0,
      comboTimer: 0,
      bestScore: getBestScore(),
      level: 1,
      isGameOver: false,
      colorChangeOnNextObstacle: false,
      backgroundOffset: 0,
      gameStarted: false,
    }),
    [getBestScore]
  );

  // 파티클 생성
  const createParticles = (
    x: number,
    y: number,
    color: string,
    count: number = 8
  ) => {
    if (!gameStateRef.current) return;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 2 + Math.random() * 3;
      gameStateRef.current.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 30,
        maxLife: 30,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  };

  // 게임 리셋
  const resetGame = useCallback(() => {
    gameStateRef.current = createInitialGameState();
    timersRef.current = { spawn: 0, colorChange: 0, powerUpSpawn: 0 };
  }, [createInitialGameState]);

  // 장애물 생성
  const spawnObstacle = (canvas: HTMLCanvasElement) => {
    if (!gameStateRef.current) return;

    const color =
      GAME_CONFIG.COLORS[Math.floor(Math.random() * GAME_CONFIG.COLORS.length)];

    // 장애물 타입 결정: 10% 보너스, 15% 높은 장애물, 75% 일반
    const rand = Math.random();
    let type: "normal" | "bonus" | "tall";
    if (rand < 0.1) {
      type = "bonus";
    } else if (rand < 0.25) {
      type = "tall";
    } else {
      type = "normal";
    }

    gameStateRef.current.obstacles.push({
      x: canvas.width,
      color,
      passed: false,
      type,
      colorChanged: false,
    });
  };

  // 파워업 생성
  const spawnPowerUp = (canvas: HTMLCanvasElement) => {
    if (!gameStateRef.current) return;

    let type: "shield" | "bonus" | "life" | "jumpBoost";

    // 생명력 아이템은 더 드물게 등장
    if (Math.random() < GAME_CONFIG.POWERUP.LIFE_SPAWN_CHANCE) {
      type = "life";
    } else {
      const regularTypes: ("shield" | "bonus" | "jumpBoost")[] = [
        "shield",
        "bonus",
        "jumpBoost",
      ];
      type = regularTypes[Math.floor(Math.random() * regularTypes.length)];
    }

    gameStateRef.current.powerUps.push({
      x: canvas.width,
      y: 350, // 고정된 높이 - 점프로 먹을 수 있는 위치
      type,
      collected: false,
    });
  };

  // 게임 시작 함수
  const startGame = () => {
    if (gameStateRef.current) {
      gameStateRef.current.gameStarted = true;
    }
  };

  // 점프 처리 - 이중 점프 지원
  const handleJump = useCallback(() => {
    if (!gameStateRef.current) return;

    // 게임이 시작되지 않았으면 게임 시작
    if (!gameStateRef.current.gameStarted) {
      startGame();
      return;
    }

    if (gameStateRef.current.isGameOver) return;

    const player = gameStateRef.current.player;

    // 바닥에 있거나 첫 번째 점프 후 이중 점프 가능
    if (player.jumpCount < 2) {
      // 점프력 상승 아이템 효과 적용
      const jumpPower =
        player.jumpBoost > 0
          ? GAME_CONFIG.PLAYER.JUMP_POWER * 1.4
          : GAME_CONFIG.PLAYER.JUMP_POWER;
      player.vy = jumpPower;
      player.isJumping = true;
      player.jumpCount++;

      // 점프 파티클 효과 (이중 점프는 더 화려하게, 점프부스트는 초록색)
      const particleCount = player.jumpCount === 2 ? 8 : 5;
      let particleColor = player.jumpCount === 2 ? "#ffa502" : player.color;
      if (player.jumpBoost > 0) particleColor = "#2ed573"; // 점프부스트 시 초록색
      createParticles(
        player.x,
        player.y + player.radius,
        particleColor,
        particleCount
      );
    }
  }, []);

  // 충돌 검사 - 높은 장애물 지원
  const checkCollision = (
    player: Player,
    obstacle: Obstacle,
    canvas: HTMLCanvasElement
  ): { hit: boolean; type: "pass" | "jump" | "collision" } => {
    // 장애물 높이 결정
    let obstacleHeight = GAME_CONFIG.OBSTACLE.HEIGHT;
    if (obstacle.type === "tall") {
      obstacleHeight = GAME_CONFIG.OBSTACLE.HEIGHT * 1.8; // 1.8배 높이
    }

    const obstacleTop = canvas.height - obstacleHeight - 20;
    const obstacleBottom = canvas.height - 20;

    // 장애물과 플레이어가 x축에서 겹치는지 확인
    const xOverlap =
      obstacle.x < player.x + player.radius &&
      obstacle.x + GAME_CONFIG.OBSTACLE.WIDTH > player.x - player.radius;

    if (!xOverlap) {
      return { hit: false, type: "pass" };
    }

    // 플레이어가 장애물 위쪽에 있는지 확인 (점프로 넘어가는 경우)
    if (player.y + player.radius <= obstacleTop + 5) {
      // 5픽셀 여유
      return { hit: false, type: "jump" };
    }

    // 플레이어가 장애물을 통과하는 경우 (같은 색일 때만 허용)
    if (
      player.y + player.radius > obstacleTop &&
      player.y - player.radius < obstacleBottom
    ) {
      return { hit: true, type: "pass" };
    }

    return { hit: false, type: "pass" };
  };

  // 파워업 충돌 검사
  const checkPowerUpCollision = (player: Player, powerUp: PowerUp): boolean => {
    const distance = Math.sqrt(
      Math.pow(player.x - (powerUp.x + 15), 2) +
        Math.pow(player.y - powerUp.y, 2)
    );
    return distance < player.radius + 15;
  };

  // 게임 루프
  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !gameStateRef.current) return;

    const ctx = canvas.getContext("2d")!;
    const gameState = gameStateRef.current;
    const { player, obstacles, powerUps, particles } = gameState;

    // 화면 클리어
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 배경 오프셋 업데이트 (천천히 움직임)
    gameState.backgroundOffset += 0.5;
    if (gameState.backgroundOffset > canvas.width) {
      gameState.backgroundOffset = 0;
    }

    // 배경 그라데이션 (움직이는 효과)
    const gradient = ctx.createLinearGradient(
      -gameState.backgroundOffset * 0.1,
      0,
      canvas.width - gameState.backgroundOffset * 0.1,
      canvas.height
    );
    gradient.addColorStop(0, "#0f0f23");
    gradient.addColorStop(0.5, "#1a1a2e");
    gradient.addColorStop(1, "#16213e");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 움직이는 별 배경 효과 (여러 레이어)
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    // 빠른 별들
    for (let i = 0; i < 30; i++) {
      const x =
        ((i * 37 - gameState.backgroundOffset * 2) % (canvas.width + 50)) - 25;
      const y = (i * 23) % canvas.height;
      if (x > -25 && x < canvas.width + 25) {
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // 중간 속도 별들
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    for (let i = 0; i < 20; i++) {
      const x =
        ((i * 53 - gameState.backgroundOffset * 1.2) % (canvas.width + 50)) -
        25;
      const y = (i * 41) % canvas.height;
      if (x > -25 && x < canvas.width + 25) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }

    // 느린 별들 (큰 별)
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    for (let i = 0; i < 10; i++) {
      const x =
        ((i * 71 - gameState.backgroundOffset * 0.8) % (canvas.width + 50)) -
        25;
      const y = (i * 67) % canvas.height;
      if (x > -25 && x < canvas.width + 25) {
        ctx.fillRect(x, y, 2, 2);
      }
    }

    // 원거리 산맥 실루엣 효과 (매우 천천히 움직임)
    ctx.fillStyle = "rgba(22, 33, 62, 0.3)";
    ctx.beginPath();
    for (let x = -50; x < canvas.width + 50; x += 20) {
      const offsetX =
        x - ((gameState.backgroundOffset * 0.2) % (canvas.width + 100));
      const height =
        100 +
        Math.sin(offsetX * 0.01 - gameState.backgroundOffset * 0.001) * 30;
      if (x === -50) {
        ctx.moveTo(offsetX, canvas.height - height);
      } else {
        ctx.lineTo(offsetX, canvas.height - height);
      }
    }
    ctx.lineTo(canvas.width + 50, canvas.height);
    ctx.lineTo(-50, canvas.height);
    ctx.closePath();
    ctx.fill();

    // 바닥 그리기 (그라데이션 효과)
    const floorGradient = ctx.createLinearGradient(
      0,
      canvas.height - 20,
      0,
      canvas.height
    );
    floorGradient.addColorStop(0, "#16213e");
    floorGradient.addColorStop(1, "#0f0f23");
    ctx.fillStyle = floorGradient;
    ctx.fillRect(0, canvas.height - 20, canvas.width, 20);

    // 게임이 시작되지 않았으면 타이틀 화면 표시
    if (!gameState.gameStarted) {
      // 타이틀 텍스트
      ctx.fillStyle = "white";
      ctx.font = `bold ${canvas.width * 0.08}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText("🌈 COLOR RUN", canvas.width / 2, canvas.height * 0.3);

      // 부제목
      ctx.font = `${canvas.width * 0.04}px Arial`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.fillText(
        "같은 색 장애물을 통과하여",
        canvas.width / 2,
        canvas.height * 0.42
      );
      ctx.fillText(
        "높은 점수를 획득하세요!",
        canvas.width / 2,
        canvas.height * 0.47
      );

      // 최고 점수 표시
      if (gameState.bestScore > 0) {
        ctx.font = `${canvas.width * 0.035}px Arial`;
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.fillText(
          `최고 점수: ${gameState.bestScore}`,
          canvas.width / 2,
          canvas.height * 0.55
        );
      }

      // 시작 버튼 (깜빡이는 효과)
      const pulse = Math.sin(Date.now() * 0.005) * 0.3 + 0.7;
      ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
      ctx.font = `bold ${canvas.width * 0.045}px Arial`;

      const startText = isMobile ? "📱 터치하여 시작" : "🖱️ 클릭하여 시작";
      ctx.fillText(startText, canvas.width / 2, canvas.height * 0.7);

      // 간단한 조작법
      ctx.font = `${canvas.width * 0.03}px Arial`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      const controlText = isMobile
        ? "터치로 점프 (이중 점프 가능)"
        : "스페이스바 또는 클릭으로 점프";
      ctx.fillText(controlText, canvas.width / 2, canvas.height * 0.8);

      // 데모 플레이어 (가운데에 떠있는 상태)
      const demoY = canvas.height * 0.6;
      ctx.beginPath();
      ctx.arc(canvas.width / 2, demoY, player.radius, 0, Math.PI * 2);
      ctx.fillStyle = player.color;
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();

      // 플레이어 눈 그리기
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(canvas.width / 2 - 6, demoY - 5, 3, 0, Math.PI * 2);
      ctx.arc(canvas.width / 2 + 6, demoY - 5, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "black";
      ctx.beginPath();
      ctx.arc(canvas.width / 2 - 6, demoY - 5, 1.5, 0, Math.PI * 2);
      ctx.arc(canvas.width / 2 + 6, demoY - 5, 1.5, 0, Math.PI * 2);
      ctx.fill();

      requestRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    // 게임이 시작된 후의 기존 게임 로직
    // 플레이어 물리 업데이트
    const gravityMultiplier = 1;
    player.vy += GAME_CONFIG.PLAYER.GRAVITY * gravityMultiplier;
    player.y += player.vy * gravityMultiplier;

    // 바닥 충돌 처리
    const groundY = canvas.height - 20 - player.radius;
    if (player.y > groundY) {
      player.y = groundY;
      player.vy = 0;
      player.isJumping = false;
      player.jumpCount = 0; // 바닥에 착지하면 점프 횟수 리셋
    }

    // 플레이어 그리기 (쉴드 효과 포함)
    if (player.shield > 0) {
      // 쉴드 효과
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius + 8, 0, Math.PI * 2);
      ctx.strokeStyle = "#00d2d3";
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 무적 상태일 때 깜빡이는 효과
    const isBlinking =
      player.invincible > 0 && Math.floor(Date.now() / 100) % 2 === 0;

    if (!isBlinking) {
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
      ctx.fillStyle = player.color;
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();

      // 플레이어 눈 그리기
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(player.x - 6, player.y - 5, 3, 0, Math.PI * 2);
      ctx.arc(player.x + 6, player.y - 5, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "black";
      ctx.beginPath();
      ctx.arc(player.x - 6, player.y - 5, 1.5, 0, Math.PI * 2);
      ctx.arc(player.x + 6, player.y - 5, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 현재 게임 속도 계산
    const speedMultiplier = 1;
    const currentSpeed = Math.min(
      GAME_CONFIG.OBSTACLE.BASE_SPEED *
        (1 +
          Math.floor(gameState.score / 100) * GAME_CONFIG.SPEED_INCREASE_RATE) *
        speedMultiplier,
      GAME_CONFIG.OBSTACLE.BASE_SPEED * GAME_CONFIG.MAX_SPEED_MULTIPLIER
    );

    // 레벨 계산
    gameState.level = Math.floor(gameState.score / 100) + 1;

    // 장애물 업데이트 및 그리기
    obstacles.forEach((obstacle) => {
      obstacle.x -= currentSpeed;

      // 장애물 높이 결정
      let obstacleHeight = GAME_CONFIG.OBSTACLE.HEIGHT;
      if (obstacle.type === "tall") {
        obstacleHeight = GAME_CONFIG.OBSTACLE.HEIGHT * 1.8;
      }

      // 장애물 그리기
      const obstacleTop = canvas.height - obstacleHeight - 20;

      // 보너스 장애물은 반짝이는 효과
      if (obstacle.type === "bonus") {
        const glow = Math.sin(Date.now() * 0.01) * 0.3 + 0.7;
        ctx.shadowColor = obstacle.color;
        ctx.shadowBlur = 10 * glow;
      }

      // 높은 장애물은 그라데이션 효과
      if (obstacle.type === "tall") {
        const gradient = ctx.createLinearGradient(
          obstacle.x,
          obstacleTop,
          obstacle.x,
          obstacleTop + obstacleHeight
        );
        gradient.addColorStop(0, obstacle.color);
        gradient.addColorStop(1, obstacle.color + "80"); // 투명도 추가
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = obstacle.color;
      }

      ctx.fillRect(
        obstacle.x,
        obstacleTop,
        GAME_CONFIG.OBSTACLE.WIDTH,
        obstacleHeight
      );

      // 장애물 타입별 표시
      if (obstacle.type === "bonus") {
        ctx.fillStyle = "white";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "center";
        ctx.fillText("★", obstacle.x + 15, obstacleTop + 30);
        ctx.shadowBlur = 0;
      } else if (obstacle.type === "tall") {
        ctx.fillStyle = "white";
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "center";
        ctx.fillText("↑↑", obstacle.x + 15, obstacleTop + 20);
      }

      ctx.strokeStyle = "white";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        obstacle.x,
        obstacleTop,
        GAME_CONFIG.OBSTACLE.WIDTH,
        obstacleHeight
      );

      // 충돌 검사
      const collision = checkCollision(player, obstacle, canvas);

      // 같은 색 장애물 통과 시 콤보 증가 처리
      if (
        collision.hit &&
        collision.type === "pass" &&
        player.color === obstacle.color
      ) {
        // 같은 색 장애물을 통과하는 경우
        if (!obstacle.passed) {
          let baseScore = 10;
          if (obstacle.type === "bonus") baseScore = 20;
          else if (obstacle.type === "tall") baseScore = 15;

          const comboBonus = Math.floor(gameState.combo / 5) * 5;
          const totalScore = baseScore + comboBonus;

          gameState.score += totalScore;
          gameState.combo += 1; // 통과할 때만 콤보 증가
          gameState.comboTimer = GAME_CONFIG.COMBO_TIMEOUT; // 5초로 리셋
          obstacle.passed = true;

          // 파티클 효과
          createParticles(
            obstacle.x + 15,
            obstacleTop + obstacleHeight / 2,
            obstacle.color,
            10
          );
        }
      }
      // 다른 색 장애물 통과 시 피해 처리
      else if (
        collision.hit &&
        collision.type === "pass" &&
        player.color !== obstacle.color
      ) {
        // 다른 색 장애물을 통과하려고 하면 충돌
        if (player.invincible <= 0) {
          if (player.shield > 0) {
            // 쉴드로 보호됨
            player.shield = 0;
            createParticles(player.x, player.y, "#00d2d3", 12);
            gameState.combo = 0; // 콤보 리셋 (피해 입음)
            gameState.comboTimer = 0; // 콤보 타이머도 리셋
            if (!obstacle.passed) {
              gameState.score += 1;
              obstacle.passed = true;
            }
          } else {
            // 생명력 감소
            player.lives--;
            player.invincible = 120; // 2초 무적
            createParticles(player.x, player.y, "#ff4757", 15);
            gameState.combo = 0; // 콤보 리셋 (피해 입음)
            gameState.comboTimer = 0; // 콤보 타이머도 리셋

            if (player.lives <= 0) {
              // 게임 오버
              gameState.isGameOver = true;
              if (gameState.score > gameState.bestScore) {
                gameState.bestScore = gameState.score;
                saveBestScore(gameState.score);
              }
              cancelAnimationFrame(requestRef.current);
              setTimeout(() => {
                alert(
                  `게임 오버! 점수: ${gameState.score}\n최고 점수: ${gameState.bestScore}`
                );
                resetGame();
                requestRef.current = requestAnimationFrame(gameLoop);
              }, 100);
              return;
            }
          }
        }
      }
      // 점프로 장애물을 넘어가는 경우 (콤보 증가 없음)
      else if (
        collision.type === "jump" &&
        obstacle.x < player.x &&
        obstacle.x + GAME_CONFIG.OBSTACLE.WIDTH > player.x
      ) {
        if (!obstacle.passed) {
          let baseScore = 1;
          if (obstacle.type === "tall") baseScore = 2;

          gameState.score += baseScore;
          // 점프할 때는 콤보 증가 안함
          obstacle.passed = true;
        }
      }

      // 장애물을 완전히 지나간 후 색상 변경 체크 (같은 색 통과한 경우만)
      if (
        obstacle.passed &&
        obstacle.x + GAME_CONFIG.OBSTACLE.WIDTH <
          player.x - player.radius - 10 &&
        !obstacle.colorChanged
      ) {
        // 같은 색이었고 통과했다면 1~10 랜덤 확률로 색상 변경 (40% 확률)
        if (player.color === obstacle.color) {
          const randomChance = Math.floor(Math.random() * 10) + 1; // 1~10
          if (randomChance <= 4) {
            // 40% 확률 (1,2,3,4가 나올 확률)
            gameState.colorChangeOnNextObstacle = true;
          }
        }
        obstacle.colorChanged = true; // 중복 처리 방지
      }
    });

    // 파워업 업데이트 및 그리기
    powerUps.forEach((powerUp) => {
      powerUp.x -= currentSpeed;

      // 파워업 그리기
      const pulse = Math.sin(Date.now() * 0.01) * 0.2 + 0.8;
      ctx.save();
      ctx.translate(powerUp.x + 15, powerUp.y);
      ctx.scale(pulse, pulse);

      // 파워업 타입별 색상과 아이콘
      switch (powerUp.type) {
        case "shield":
          ctx.fillStyle = "#00d2d3";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 15, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "white";
          ctx.font = "bold 16px Arial";
          ctx.textAlign = "center";
          ctx.fillText("🛡", 0, 5);
          break;
        case "bonus":
          ctx.fillStyle = "#ff6b9d";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 15, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "white";
          ctx.font = "bold 16px Arial";
          ctx.textAlign = "center";
          ctx.fillText("💎", 0, 5);
          break;
        case "life":
          ctx.fillStyle = "#ff4757";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 15, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "white";
          ctx.font = "bold 16px Arial";
          ctx.textAlign = "center";
          ctx.fillText("❤️", 0, 5);
          break;
        case "jumpBoost":
          ctx.fillStyle = "#2ed573";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 15, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "white";
          ctx.font = "bold 16px Arial";
          ctx.textAlign = "center";
          ctx.fillText("🚀", 0, 5);
          break;
      }
      ctx.restore();

      // 파워업 충돌 검사
      if (checkPowerUpCollision(player, powerUp) && !powerUp.collected) {
        powerUp.collected = true;
        createParticles(powerUp.x + 15, powerUp.y, "#ffa502", 15);

        switch (powerUp.type) {
          case "shield":
            player.shield = GAME_CONFIG.POWERUP.DURATION;
            break;
          case "bonus":
            gameState.score += 50;
            break;
          case "life":
            if (player.lives < 3) {
              // 최대 3개까지만
              player.lives++;
            }
            break;
          case "jumpBoost":
            player.jumpBoost = GAME_CONFIG.POWERUP.DURATION;
            break;
        }
      }
    });

    // 파티클 업데이트 및 그리기
    particles.forEach((particle, index) => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.1; // 중력
      particle.life--;

      const alpha = particle.life / particle.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (particle.life <= 0) {
        particles.splice(index, 1);
      }
    });

    // 화면 밖으로 나간 요소들 제거
    gameState.obstacles = obstacles.filter(
      (obs) => obs.x > -GAME_CONFIG.OBSTACLE.WIDTH
    );
    gameState.powerUps = powerUps.filter(
      (powerUp) => powerUp.x > -30 && !powerUp.collected
    );

    // 장애물 생성
    timersRef.current.spawn++;
    if (
      timersRef.current.spawn >
      GAME_CONFIG.OBSTACLE.SPAWN_INTERVAL - Math.floor(gameState.level * 2)
    ) {
      spawnObstacle(canvas);
      timersRef.current.spawn = 0;
    }

    // 파워업 생성
    timersRef.current.powerUpSpawn++;
    if (
      timersRef.current.powerUpSpawn > 200 &&
      Math.random() < GAME_CONFIG.POWERUP.SPAWN_CHANCE
    ) {
      spawnPowerUp(canvas);
      timersRef.current.powerUpSpawn = 0;
    }

    // 플레이어 색상 변경 - 장애물 통과 후에만 변경
    if (gameState.colorChangeOnNextObstacle) {
      const availableColors = GAME_CONFIG.COLORS.filter(
        (color) => color !== player.color
      );
      const newColor =
        availableColors[Math.floor(Math.random() * availableColors.length)];
      player.color = newColor;
      createParticles(player.x, player.y, player.color, 6);
      gameState.colorChangeOnNextObstacle = false;
    }

    // 파워업 타이머 감소
    if (player.shield > 0) player.shield--;
    if (player.jumpBoost > 0) player.jumpBoost--;
    if (player.invincible > 0) player.invincible--; // 무적 시간 감소

    // 콤보 타이머 감소
    if (gameState.comboTimer > 0) {
      gameState.comboTimer--;
    } else {
      gameState.combo = 0;
    }

    // UI 그리기
    ctx.fillStyle = "white";
    ctx.font = "bold 28px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`${gameState.score}`, canvas.width / 2, 40);

    ctx.font = "16px Arial";
    ctx.fillText(
      `레벨 ${gameState.level} | 속도 ${currentSpeed.toFixed(1)}x`,
      canvas.width / 2,
      65
    );

    // 생명력 표시
    ctx.fillStyle = "#ff4757";
    ctx.font = "20px Arial";
    ctx.textAlign = "left";
    let heartsText = "";
    for (let i = 0; i < player.lives; i++) {
      heartsText += "❤️";
    }
    ctx.fillText(heartsText, 10, 50);

    // 콤보 표시
    if (gameState.combo > 1) {
      ctx.fillStyle = "#ff6b9d";
      ctx.font = "bold 20px Arial";
      ctx.textAlign = "center";
      ctx.fillText(`${gameState.combo}x COMBO!`, canvas.width / 2, 90);
    }

    // 최고 점수 표시
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.font = "14px Arial";
    ctx.textAlign = "right";
    ctx.fillText(`최고: ${gameState.bestScore}`, canvas.width - 10, 25);

    // 파워업 상태 표시
    ctx.textAlign = "left";
    let statusY = 25;
    if (player.shield > 0) {
      ctx.fillStyle = "#00d2d3";
      ctx.fillText(`🛡 ${Math.ceil(player.shield / 60)}s`, 10, statusY);
      statusY += 20;
    }
    if (player.jumpBoost > 0) {
      ctx.fillStyle = "#2ed573";
      ctx.fillText(`🚀 ${Math.ceil(player.jumpBoost / 60)}s`, 10, statusY);
    }

    if (!gameState.isGameOver) {
      requestRef.current = requestAnimationFrame(gameLoop);
    }
  }, [
    handleJump,
    createInitialGameState,
    getBestScore,
    saveBestScore,
    isMobile,
    resetGame,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 게임 상태 초기화
    resetGame();

    // 반응형 캔버스 설정
    const updateCanvasSize = () => {
      const maxWidth = isMobile
        ? Math.min(window.innerWidth - 20, 380)
        : GAME_CONFIG.CANVAS_WIDTH;
      const maxHeight = isMobile
        ? Math.min(window.innerHeight - 200, 500)
        : GAME_CONFIG.CANVAS_HEIGHT;

      canvas.width = maxWidth;
      canvas.height = maxHeight;
    };

    updateCanvasSize();
    window.addEventListener("resize", updateCanvasSize);

    // 키보드 이벤트
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        handleJump();
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      handleJump();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
    };

    // 이벤트 리스너 등록
    window.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("touchstart", handleTouchStart);
    canvas.addEventListener("touchend", handleTouchEnd);
    canvas.addEventListener("click", handleJump);

    // 게임 루프 시작
    requestRef.current = requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener("resize", updateCanvasSize);
      window.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("click", handleJump);
      cancelAnimationFrame(requestRef.current);
    };
  }, [handleJump, gameLoop, resetGame, isMobile]);

  // 클라이언트 사이드에서만 렌더링
  if (!isClient) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          backgroundColor: "#0f0f23",
          fontFamily: "Arial, sans-serif",
          padding: "10px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ color: "white", textAlign: "center" }}>
          <h1>🌈 Color Run</h1>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        backgroundColor: "#0f0f23",
        fontFamily: "Arial, sans-serif",
        padding: "10px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ textAlign: "center", width: "100%", maxWidth: "500px" }}>
        <canvas
          ref={canvasRef}
          style={{
            border: "3px solid #16213e",
            borderRadius: "15px",
            boxShadow: "0 0 30px rgba(255, 255, 255, 0.2)",
            background: "linear-gradient(45deg, #0f0f23, #1a1a2e)",
            maxWidth: "100%",
            height: "auto",
            touchAction: "none", // 터치 스크롤 방지
          }}
        />
        <div
          style={{
            color: "rgba(255, 255, 255, 0.8)",
            marginTop: "15px",
            fontSize: isMobile ? "12px" : "14px",
            maxWidth: "100%",
          }}
        >
          {isMobile && (
            <p style={{ fontSize: "11px", marginTop: "10px" }}>
              📱 화면을 터치하여 점프하세요!
            </p>
          )}
        </div>
        {!isMobile && (
          <div
            style={{
              color: "rgba(255, 255, 255, 0.6)",
              marginTop: "10px",
              fontSize: "12px",
              maxWidth: "100%",
              textAlign: "left",
            }}
          >
            <p>
              📋 <strong>게임 규칙:</strong>
            </p>
            <p>• 같은 색 장애물: 통과 (+10점, 높은 장애물 +15점)</p>
            <p>• 다른 색 장애물: 점프로 피하기 (+1점, 높은 장애물 +2점)</p>
            <p>• ★ 보너스 장애물: +20점</p>
            <p>• ↑↑ 높은 장애물: 이중 점프 필요</p>
            <p>• 🛡 쉴드, 🚀 점프부스트, 💎 보너스, ❤️ 생명력</p>
            <p>• 스페이스바 또는 클릭으로 점프 (이중 점프 가능!)</p>
          </div>
        )}
      </div>
    </div>
  );
}
