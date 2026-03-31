import {
	AuthError,
	findStreamKeyForQuest,
	getPublicApplication,
	RateLimitError,
	sendHeartbeat,
	sendHeartbeatNative,
} from "../api";
import { FluxDispatcher, getApplicationStreamingStore, getRunningGameStore } from "../stores";
import type { QuestTaskType } from "../types";
import { updateTaskProgress } from "./index";

const HEARTBEAT_INTERVAL_MS = 25_000; // 25s between heartbeats

function getProgress(quest: any, taskType: QuestTaskType): number {
	const us = quest?.userStatus ?? quest?.user_status;
	if (!us) return 0;

	const progress = us?.progress?.[taskType];
	if (progress?.value != null) return progress.value;
	return us?.streamProgressSeconds ?? us?.stream_progress_seconds ?? 0;
}

function prop(obj: any, ...keys: string[]): any {
	if (!obj) return undefined;
	for (const key of keys) {
		if (obj[key] !== undefined) return obj[key];
	}
	return undefined;
}

function getApplicationId(quest: any): string {
	return String(quest?.config?.application?.id ?? "");
}

function getApplicationName(quest: any): string {
	return String(quest?.config?.application?.name ?? quest?.id ?? "unknown");
}

function getConfigVersion(quest: any): number {
	return Number(prop(quest?.config, "configVersion", "config_version") ?? 2);
}

function getProgressFromStatus(
	status: any,
	taskType: QuestTaskType,
	configVersion: number,
): number {
	if (!status) return 0;
	const taskProgress = status?.progress?.[taskType];
	if (taskProgress?.value != null) return Number(taskProgress.value);
	if (configVersion === 1) {
		return Number(prop(status, "streamProgressSeconds", "stream_progress_seconds") ?? 0);
	}
	return Number(prop(status, "streamProgressSeconds", "stream_progress_seconds") ?? 0);
}

function getHeartbeatEventProgress(
	event: any,
	taskType: QuestTaskType,
	configVersion: number,
): number {
	const status = prop(event, "userStatus", "user_status")
		?? prop(event?.body, "userStatus", "user_status");
	return getProgressFromStatus(status, taskType, configVersion);
}

function getHeartbeatEventQuestId(event: any): string | undefined {
	return prop(event, "questId", "quest_id") ?? prop(event?.body, "questId", "quest_id");
}

async function startManualHeartbeatLoop(
	quest: any,
	taskType: QuestTaskType,
	target: number,
	onComplete: () => void,
	streamKey: string,
): Promise<() => void> {
	let cancelled = false;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let currentProgress = getProgress(quest, taskType);
	const doHeartbeat = taskType === "PLAY_ACTIVITY" ? sendHeartbeatNative : sendHeartbeat;

	async function beat(terminal = false) {
		if (cancelled) return;

		try {
			const resp = await doHeartbeat(quest.id, streamKey, terminal);
			const taskProgress = resp?.progress?.[taskType];
			if (taskProgress?.value != null) {
				currentProgress = taskProgress.value;
			}

			updateTaskProgress(quest.id, currentProgress, "running");
			console.log(
				`[CompleteDiscordQuest] Heartbeat OK for ${quest.id}: ${currentProgress}/${target}s`,
			);

			if (!terminal && currentProgress >= target) {
				try {
					await doHeartbeat(quest.id, streamKey, true);
				} catch {
					// ignore terminal heartbeat errors
				}
				onComplete();
				return;
			}
		} catch (e) {
			if (e instanceof RateLimitError) {
				updateTaskProgress(
					quest.id,
					currentProgress,
					"rate-limited",
					`Rate limited ${e.retryAfter}s`,
				);
				timeoutId = setTimeout(() => beat(false), e.retryAfter * 1000);
				return;
			}
			if (e instanceof AuthError) {
				updateTaskProgress(quest.id, currentProgress, "error", e.message);
				console.error(`[CompleteDiscordQuest] Auth error for ${quest.id}: ${e.message}`);
				timeoutId = setTimeout(() => beat(false), 30_000);
				return;
			}
			const errMsg = e instanceof Error ? e.message : String(e);
			updateTaskProgress(quest.id, currentProgress, "error", errMsg);
			console.error(`[CompleteDiscordQuest] Heartbeat error for ${quest.id}:`, e);
		}

		if (!cancelled && !terminal) {
			timeoutId = setTimeout(() => beat(false), HEARTBEAT_INTERVAL_MS);
		}
	}

	if (currentProgress >= target) {
		onComplete();
		return () => {};
	}

	beat(false);

	return () => {
		cancelled = true;
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};
}

function startDesktopPlayTask(
	quest: any,
	target: number,
	onComplete: () => void,
): () => void {
	let cancelled = false;
	let currentProgress = getProgress(quest, "PLAY_ON_DESKTOP");
	let manualCleanup: (() => void) | null = null;
	let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

	const applicationId = getApplicationId(quest);
	const applicationName = getApplicationName(quest);
	const configVersion = getConfigVersion(quest);
	const runningGameStore = getRunningGameStore();

	if (!runningGameStore?.getRunningGames || !runningGameStore?.getGameForPID) {
		updateTaskProgress(quest.id, currentProgress, "error", "RunningGameStore unavailable");
		console.error("[CompleteDiscordQuest] RunningGameStore unavailable for PLAY_ON_DESKTOP");
		return () => {};
	}

	const originalGetRunningGames = runningGameStore.getRunningGames.bind(runningGameStore);
	const originalGetGameForPID = runningGameStore.getGameForPID.bind(runningGameStore);
	const previousGames = originalGetRunningGames() ?? [];
	const pid = Math.floor(Math.random() * 30000) + 1000;

	const eventHandler = (event: any) => {
		if (getHeartbeatEventQuestId(event) !== quest.id) return;
		currentProgress = getHeartbeatEventProgress(event, "PLAY_ON_DESKTOP", configVersion);
		updateTaskProgress(quest.id, currentProgress, "running");
		console.log(
			`[CompleteDiscordQuest] PLAY_ON_DESKTOP progress for ${applicationName}: ${currentProgress}/${target}`,
		);

		if (currentProgress >= target) {
			cleanup();
			onComplete();
		}
	};

	FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", eventHandler);

	const cleanup = () => {
		if (cancelled) return;
		cancelled = true;
		if (fallbackTimer !== null) {
			clearTimeout(fallbackTimer);
			fallbackTimer = null;
		}
		manualCleanup?.();
		manualCleanup = null;
		runningGameStore.getRunningGames = originalGetRunningGames;
		runningGameStore.getGameForPID = originalGetGameForPID;
		FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", eventHandler);
		try {
			FluxDispatcher.dispatch({
				type: "RUNNING_GAMES_CHANGE",
				removed: [{ id: applicationId, pid }],
				added: previousGames,
				games: previousGames,
			});
		} catch {
			// ignore cleanup dispatch errors
		}
	};

	void (async () => {
		try {
			const appData = await getPublicApplication(applicationId);
			const exeName = appData?.executables?.find?.((x: any) =>
				x.os === "win32"
			)?.name?.replace?.(">", "")
				?? applicationName.replace(/[\\/:*?"<>|]/g, "");
			const fakeGame = {
				cmdLine: `C:\\Program Files\\${applicationName}\\${exeName}`,
				exeName,
				exePath: `c:/program files/${applicationName.toLowerCase()}/${exeName}`,
				hidden: false,
				isLauncher: false,
				id: applicationId,
				name: applicationName,
				pid,
				pidPath: [pid],
				processName: applicationName,
				start: Date.now(),
			};

			runningGameStore.getRunningGames = () => [fakeGame];
			runningGameStore.getGameForPID = (queryPid: number) => {
				return queryPid === pid ? fakeGame : undefined;
			};

			FluxDispatcher.dispatch({
				type: "RUNNING_GAMES_CHANGE",
				removed: previousGames,
				added: [fakeGame],
				games: [fakeGame],
			});

			updateTaskProgress(quest.id, currentProgress, "running");
			console.log(`[CompleteDiscordQuest] Spoofed running game for ${applicationName}`);

			fallbackTimer = setTimeout(async () => {
				if (cancelled || currentProgress > 0) return;
				const streamKey = await findStreamKeyForQuest(quest.id);
				console.log(
					`[CompleteDiscordQuest] No internal heartbeat yet for ${applicationName}, trying REST fallback with ${streamKey}`,
				);
				manualCleanup = await startManualHeartbeatLoop(
					quest,
					"PLAY_ON_DESKTOP",
					target,
					() => {
						cleanup();
						onComplete();
					},
					streamKey,
				);
			}, 20_000);
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e);
			updateTaskProgress(quest.id, currentProgress, "error", errMsg);
			console.error(
				`[CompleteDiscordQuest] Failed to spoof PLAY_ON_DESKTOP for ${applicationName}:`,
				e,
			);
		}
	})();

	return cleanup;
}

function startDesktopStreamTask(
	quest: any,
	target: number,
	onComplete: () => void,
): () => void {
	let cancelled = false;
	let currentProgress = getProgress(quest, "STREAM_ON_DESKTOP");
	let manualCleanup: (() => void) | null = null;
	let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

	const applicationId = getApplicationId(quest);
	const configVersion = getConfigVersion(quest);
	const applicationName = getApplicationName(quest);
	const streamingStore = getApplicationStreamingStore();

	if (!streamingStore?.getStreamerActiveStreamMetadata) {
		updateTaskProgress(quest.id, currentProgress, "error", "ApplicationStreamingStore unavailable");
		console.error(
			"[CompleteDiscordQuest] ApplicationStreamingStore unavailable for STREAM_ON_DESKTOP",
		);
		return () => {};
	}

	const originalGetStreamerActiveStreamMetadata = streamingStore.getStreamerActiveStreamMetadata
		.bind(streamingStore);
	const pid = Math.floor(Math.random() * 30000) + 1000;

	const eventHandler = (event: any) => {
		if (getHeartbeatEventQuestId(event) !== quest.id) return;
		currentProgress = getHeartbeatEventProgress(event, "STREAM_ON_DESKTOP", configVersion);
		updateTaskProgress(quest.id, currentProgress, "running");
		console.log(
			`[CompleteDiscordQuest] STREAM_ON_DESKTOP progress for ${applicationName}: ${currentProgress}/${target}`,
		);

		if (currentProgress >= target) {
			cleanup();
			onComplete();
		}
	};

	FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", eventHandler);

	const cleanup = () => {
		if (cancelled) return;
		cancelled = true;
		if (fallbackTimer !== null) {
			clearTimeout(fallbackTimer);
			fallbackTimer = null;
		}
		manualCleanup?.();
		manualCleanup = null;
		streamingStore.getStreamerActiveStreamMetadata = originalGetStreamerActiveStreamMetadata;
		FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", eventHandler);
	};

	streamingStore.getStreamerActiveStreamMetadata = () => ({
		id: applicationId,
		pid,
		sourceName: null,
	});

	updateTaskProgress(quest.id, currentProgress, "running");
	console.log(`[CompleteDiscordQuest] Spoofed active stream metadata for ${applicationName}`);

	fallbackTimer = setTimeout(async () => {
		if (cancelled || currentProgress > 0) return;
		const streamKey = await findStreamKeyForQuest(quest.id);
		manualCleanup = await startManualHeartbeatLoop(
			quest,
			"STREAM_ON_DESKTOP",
			target,
			() => {
				cleanup();
				onComplete();
			},
			streamKey,
		);
	}, 20_000);

	return cleanup;
}

export function startHeartbeatTask(
	quest: any,
	taskType: QuestTaskType,
	target: number,
	onComplete: () => void,
): () => void {
	const currentProgress = getProgress(quest, taskType);
	if (currentProgress >= target) {
		onComplete();
		return () => {};
	}

	if (taskType === "PLAY_ON_DESKTOP") {
		return startDesktopPlayTask(quest, target, onComplete);
	}

	if (taskType === "STREAM_ON_DESKTOP") {
		return startDesktopStreamTask(quest, target, onComplete);
	}

	let cleanup: (() => void) | null = null;
	void findStreamKeyForQuest(quest.id).then((streamKey) => {
		return startManualHeartbeatLoop(quest, taskType, target, onComplete, streamKey);
	}).then((fn) => {
		cleanup = fn;
	});
	return () => cleanup?.();
}
