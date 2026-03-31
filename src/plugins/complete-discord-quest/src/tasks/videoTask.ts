import { AuthError, RateLimitError, sendVideoProgress } from "../api";
import type { QuestTaskType } from "../types";
import { updateTaskProgress } from "./index";

function getProgress(quest: any, taskType: QuestTaskType): number {
	const us = quest?.userStatus ?? quest?.user_status;
	const progress = us?.progress?.[taskType];
	return progress?.value ?? 0;
}

export function startVideoTask(
	quest: any,
	taskType: QuestTaskType,
	target: number,
	onComplete: () => void,
): () => void {
	let cancelled = false;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let currentProgress = getProgress(quest, taskType);

	const us = quest?.userStatus ?? quest?.user_status;
	const enrolledAtStr = us?.enrolledAt ?? us?.enrolled_at;
	const enrolledAt = enrolledAtStr
		? new Date(enrolledAtStr).getTime() / 1000
		: Date.now() / 1000;

	async function tick() {
		if (cancelled || currentProgress >= target) {
			if (!cancelled) onComplete();
			return;
		}

		const elapsed = Date.now() / 1000 - enrolledAt;
		// Only send if enough real time has passed relative to our fake progress
		if (elapsed + 10 - currentProgress >= 7) {
			const next = Math.min(target, currentProgress + 7 + Math.random());

			try {
				const resp = await sendVideoProgress(quest.id, next);
				currentProgress = next;
				updateTaskProgress(quest.id, currentProgress, "running");

				const taskProgress = resp?.progress?.[taskType];
				if (taskProgress?.completed_at || taskProgress?.completedAt || currentProgress >= target) {
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
					timeoutId = setTimeout(tick, e.retryAfter * 1000);
					return;
				}
				if (e instanceof AuthError) {
					updateTaskProgress(quest.id, currentProgress, "error", "Auth failed (401/403)");
					console.error(`[CompleteDiscordQuest] Auth failed, stopping video task`);
					cancelled = true;
					return;
				}
				const errMsg = e instanceof Error ? e.message : String(e);
				updateTaskProgress(quest.id, currentProgress, "error", errMsg);
				console.error(`[CompleteDiscordQuest] Video progress error for ${quest.id}:`, e);
			}
		}

		if (!cancelled) {
			timeoutId = setTimeout(tick, 1000);
		}
	}

	// If already complete, resolve immediately
	if (currentProgress >= target) {
		onComplete();
		return () => {};
	}

	// Start initial tick
	tick();

	return () => {
		cancelled = true;
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};
}
