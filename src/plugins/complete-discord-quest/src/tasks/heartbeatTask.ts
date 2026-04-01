import {
	AuthError,
	findStreamKeyForQuest,
	getPublicApplication,
	RateLimitError,
	sendHeartbeat,
	sendHeartbeatNative,
} from "../api";
import {
	FluxDispatcher,
	getApplicationStreamingStore,
	getQuestsStore,
	getRunningGameStore,
} from "../stores";
import type { QuestTaskType } from "../types";
import { updateTaskProgress } from "./index";

const HEARTBEAT_INTERVAL_MS = 30_000; // Match the working script's cadence
const STORE_POLL_INTERVAL_MS = 5_000;
const INITIAL_FAKE_PID = 41_000;

let nextFakePid = INITIAL_FAKE_PID;

const fakeGames = new Map<string, any>();
const fakeApplications = new Map<string, any>();

let restoreRunningGameStore: (() => void) | null = null;
let restoreApplicationStreamingStore: (() => void) | null = null;

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

function toArray<T>(value: any): T[] {
	return Array.isArray(value) ? value : [];
}

function sanitizeName(value: unknown): string {
	if (typeof value !== "string") return "DiscordQuest";
	const normalized = value.replace(/[\\/:*?"<>|]/g, "").trim();
	return normalized.length > 0 ? normalized : "DiscordQuest";
}

function getLiveQuest(questId: string): any | null {
	const rawQuests = getQuestsStore()?.quests;
	if (!rawQuests) return null;

	if (typeof rawQuests.get === "function") {
		return rawQuests.get(questId) ?? null;
	}

	if (Array.isArray(rawQuests)) {
		return rawQuests.find((quest) => quest?.id === questId) ?? null;
	}

	if (typeof rawQuests === "object") {
		return rawQuests[questId]
			?? Object.values(rawQuests).find((quest: any) => quest?.id === questId)
			?? null;
	}

	return null;
}

function ensureDesktopStoreOverrides(): void {
	if (!restoreRunningGameStore) {
		const runningGameStore = getRunningGameStore();
		if (runningGameStore && typeof runningGameStore.getRunningGames === "function") {
			const originalGetRunningGames = runningGameStore.getRunningGames.bind(runningGameStore);
			const originalGetGameForPID =
				typeof runningGameStore.getGameForPID === "function"
					? runningGameStore.getGameForPID.bind(runningGameStore)
					: undefined;

			runningGameStore.getRunningGames = () => {
				const realGames = toArray<any>(originalGetRunningGames());
				if (fakeGames.size === 0) {
					return realGames;
				}

				const fakeByPid = new Set(Array.from(fakeGames.values()).map((game) => game.pid));
				return [
					...realGames.filter((game) => !fakeByPid.has(game?.pid)),
					...fakeGames.values(),
				];
			};

			runningGameStore.getGameForPID = (pid: number) => {
				const fakeGame = Array.from(fakeGames.values()).find((game) => game.pid === pid);
				return fakeGame ?? originalGetGameForPID?.(pid);
			};

			restoreRunningGameStore = () => {
				runningGameStore.getRunningGames = originalGetRunningGames;
				if (originalGetGameForPID) {
					runningGameStore.getGameForPID = originalGetGameForPID;
				}
			};

			console.log("[CompleteDiscordQuest] RunningGameStore patched for desktop spoofing");
		}
	}

	if (!restoreApplicationStreamingStore) {
		const applicationStreamingStore = getApplicationStreamingStore();
		if (
			applicationStreamingStore
			&& typeof applicationStreamingStore.getStreamerActiveStreamMetadata === "function"
		) {
			const originalGetStreamerActiveStreamMetadata =
				applicationStreamingStore.getStreamerActiveStreamMetadata.bind(applicationStreamingStore);

			applicationStreamingStore.getStreamerActiveStreamMetadata = () => {
				const fakeMetadata = Array.from(fakeApplications.values()).at(0);
				return fakeMetadata ?? originalGetStreamerActiveStreamMetadata();
			};

			restoreApplicationStreamingStore = () => {
				applicationStreamingStore.getStreamerActiveStreamMetadata =
					originalGetStreamerActiveStreamMetadata;
			};

			console.log(
				"[CompleteDiscordQuest] ApplicationStreamingStore patched for desktop spoofing",
			);
		}
	}
}

function dispatchRunningGamesChange(removed: any[], added: any[]): void {
	const runningGameStore = getRunningGameStore();
	const games =
		typeof runningGameStore?.getRunningGames === "function"
			? toArray<any>(runningGameStore.getRunningGames())
			: Array.from(fakeGames.values());

	FluxDispatcher.dispatch({
		type: "RUNNING_GAMES_CHANGE",
		removed,
		added,
		games,
	});
}

function startNativeProgressWatcher(
	quest: any,
	taskType: QuestTaskType,
	target: number,
	onComplete: () => void,
	stopSpoof: () => void,
): () => void {
	let cancelled = false;
	let intervalId: ReturnType<typeof setInterval> | null = null;

	const cleanup = () => {
		if (cancelled) return;
		cancelled = true;
		FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", syncProgress);
		FluxDispatcher.unsubscribe("QUESTS_USER_STATUS_UPDATE", syncProgress);
		if (intervalId !== null) {
			clearInterval(intervalId);
			intervalId = null;
		}
		stopSpoof();
	};

	const syncProgress = (event?: any) => {
		if (cancelled) return;

		const eventQuestId = prop(event, "questId", "quest_id");
		if (eventQuestId && eventQuestId !== quest.id) {
			return;
		}

		const liveQuest = getLiveQuest(quest.id) ?? quest;
		const progress = getProgress(liveQuest, taskType);
		updateTaskProgress(quest.id, progress, "running");

		if (progress >= target) {
			cleanup();
			onComplete();
		}
	};

	FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", syncProgress);
	FluxDispatcher.subscribe("QUESTS_USER_STATUS_UPDATE", syncProgress);
	intervalId = setInterval(syncProgress, STORE_POLL_INTERVAL_MS);
	syncProgress();

	return cleanup;
}

async function startPlayOnDesktopSpoof(
	quest: any,
	taskType: QuestTaskType,
	target: number,
	onComplete: () => void,
): Promise<() => void> {
	ensureDesktopStoreOverrides();

	if (!getRunningGameStore()) {
		throw new Error("RunningGameStore unavailable");
	}

	const applicationId = String(prop(quest?.config?.application, "id") ?? quest.id);
	const application = applicationId !== quest.id ? await getPublicApplication(applicationId) : null;
	const applicationName = sanitizeName(
		prop(application, "name")
			?? prop(quest?.config?.application, "name")
			?? quest.id,
	);
	const executable = toArray<any>(application?.executables).find((entry) => entry?.os === "win32");
	const exeName = sanitizeName(executable?.name?.replace?.(">", "") ?? `${applicationName}.exe`);
	const pid = nextFakePid++;

	const fakeGame = {
		cmdLine: `C:\\Program Files\\${applicationName}\\${exeName}`,
		exeName,
		exePath: `c:/program files/${applicationName.toLowerCase()}/${exeName.toLowerCase()}`,
		hidden: false,
		id: applicationId,
		isLauncher: false,
		name: applicationName,
		pid,
		pidPath: [pid],
		processName: applicationName,
		start: Date.now(),
	};

	fakeGames.set(quest.id, fakeGame);
	dispatchRunningGamesChange([], [fakeGame]);
	console.log(
		`[CompleteDiscordQuest] Native PLAY_ON_DESKTOP spoof active for ${quest.id} with pid=${pid}`,
	);

	return startNativeProgressWatcher(quest, taskType, target, onComplete, () => {
		const activeFakeGame = fakeGames.get(quest.id);
		if (!activeFakeGame) return;

		fakeGames.delete(quest.id);
		dispatchRunningGamesChange([activeFakeGame], []);
		console.log(`[CompleteDiscordQuest] Native PLAY_ON_DESKTOP spoof removed for ${quest.id}`);
	});
}

async function startStreamOnDesktopSpoof(
	quest: any,
	taskType: QuestTaskType,
	target: number,
	onComplete: () => void,
): Promise<() => void> {
	ensureDesktopStoreOverrides();

	if (!getApplicationStreamingStore()) {
		throw new Error("ApplicationStreamingStore unavailable");
	}

	const applicationId = String(prop(quest?.config?.application, "id") ?? quest.id);
	const applicationName = sanitizeName(
		prop(quest?.config?.application, "name") ?? quest.id,
	);
	const fakeApplication = {
		id: applicationId,
		name: `FakeApp ${applicationName} (CompleteDiscordQuest)`,
		pid: nextFakePid++,
		sourceName: null,
	};

	fakeApplications.set(quest.id, fakeApplication);
	console.log(
		`[CompleteDiscordQuest] Native STREAM_ON_DESKTOP spoof active for ${quest.id}`,
	);

	return startNativeProgressWatcher(quest, taskType, target, onComplete, () => {
		if (!fakeApplications.has(quest.id)) return;
		fakeApplications.delete(quest.id);
		console.log(
			`[CompleteDiscordQuest] Native STREAM_ON_DESKTOP spoof removed for ${quest.id}`,
		);
	});
}

async function startManualHeartbeatLoop(
	quest: any,
	taskType: QuestTaskType,
	target: number,
	onComplete: () => void,
	streamKey: string,
	errorPrefix = "",
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
				`[CompleteDiscordQuest] ${taskType} heartbeat OK for ${quest.id}: ${currentProgress}/${target}s`,
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
				updateTaskProgress(quest.id, currentProgress, "error", `${errorPrefix}${e.message}`);
				console.error(`[CompleteDiscordQuest] Auth error for ${quest.id}: ${e.message}`);
				timeoutId = setTimeout(() => beat(false), 30_000);
				return;
			}
			const errMsg = e instanceof Error ? e.message : String(e);
			updateTaskProgress(quest.id, currentProgress, "error", `${errorPrefix}${errMsg}`);
			console.error(`[CompleteDiscordQuest] ${taskType} heartbeat error for ${quest.id}:`, e);
		}

		if (!cancelled && !terminal) {
			timeoutId = setTimeout(() => beat(false), HEARTBEAT_INTERVAL_MS);
		}
	}

	if (currentProgress >= target) {
		onComplete();
		return () => {};
	}

	console.log(
		`[CompleteDiscordQuest] Starting ${taskType} loop for ${quest.id} with stream_key=${streamKey}`,
	);
	beat(false);

	return () => {
		cancelled = true;
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};
}

export function teardownDesktopTaskRuntime(): void {
	fakeGames.clear();
	fakeApplications.clear();
	restoreRunningGameStore?.();
	restoreApplicationStreamingStore?.();
	restoreRunningGameStore = null;
	restoreApplicationStreamingStore = null;
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

	let cleanup: (() => void) | null = null;
	let cancelled = false;
	let manualErrorPrefix = "";

	const setCleanup = (nextCleanup: () => void): boolean => {
		if (cancelled) {
			nextCleanup();
			return false;
		}

		cleanup = nextCleanup;
		return true;
	};

	void (async () => {
		try {
			if (taskType === "PLAY_ON_DESKTOP") {
				try {
					const nextCleanup = await startPlayOnDesktopSpoof(quest, taskType, target, onComplete);
					setCleanup(nextCleanup);
					return;
				} catch (e) {
					manualErrorPrefix = `native=${e instanceof Error ? e.message : String(e)} | `;
					console.error(
						`[CompleteDiscordQuest] Native PLAY_ON_DESKTOP spoof failed for ${quest.id}, falling back to heartbeat:`,
						e,
					);
				}
			}

			if (taskType === "STREAM_ON_DESKTOP") {
				try {
					const nextCleanup = await startStreamOnDesktopSpoof(quest, taskType, target, onComplete);
					setCleanup(nextCleanup);
					return;
				} catch (e) {
					manualErrorPrefix = `native=${e instanceof Error ? e.message : String(e)} | `;
					console.error(
						`[CompleteDiscordQuest] Native STREAM_ON_DESKTOP spoof failed for ${quest.id}, falling back to heartbeat:`,
						e,
					);
				}
			}

			const streamKey = await findStreamKeyForQuest(quest.id);
			if (cancelled) return;

			const nextCleanup = await startManualHeartbeatLoop(
				quest,
				taskType,
				target,
				onComplete,
				streamKey,
				manualErrorPrefix,
			);
			setCleanup(nextCleanup);
		} catch (e) {
			if (cancelled) return;
			const errMsg = e instanceof Error ? e.message : String(e);
			updateTaskProgress(quest.id, currentProgress, "error", errMsg);
			console.error(`[CompleteDiscordQuest] Failed to start ${taskType} for ${quest.id}:`, e);
		}
	})();

	return () => {
		cancelled = true;
		cleanup?.();
		cleanup = null;
	};
}
