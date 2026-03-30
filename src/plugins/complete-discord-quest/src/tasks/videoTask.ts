import { sendVideoProgress, RateLimitError, AuthError } from "../api";
import type { Quest, QuestTaskType } from "../types";

function getProgress(quest: Quest, taskType: QuestTaskType): number {
	const progress = quest.user_status?.progress?.[taskType];
	return progress?.value ?? 0;
}

export function startVideoTask(
	quest: Quest,
	taskType: QuestTaskType,
	target: number,
	onComplete: () => void,
): () => void {
	let cancelled = false;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let currentProgress = getProgress(quest, taskType);

	const enrolledAt = quest.user_status?.enrolled_at
		? new Date(quest.user_status.enrolled_at).getTime() / 1000
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

				const taskProgress = resp?.progress?.[taskType];
				if (taskProgress?.completed_at || currentProgress >= target) {
					onComplete();
					return;
				}
			} catch (e) {
				if (e instanceof RateLimitError) {
					timeoutId = setTimeout(tick, e.retryAfter * 1000);
					return;
				}
				if (e instanceof AuthError) {
					console.error(`[CompleteDiscordQuest] Auth failed, stopping video task`);
					cancelled = true;
					return;
				}
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
