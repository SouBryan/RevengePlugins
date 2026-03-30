// ---- Quest API Response Types ----

export interface Quest {
	id: string;
	preview: boolean;
	config: QuestConfig;
	user_status: QuestUserStatus | null;
	targeted_content: any[];
}

export interface QuestConfig {
	id: string;
	config_version: number;
	starts_at: string;
	expires_at: string;
	features: number[];
	application: QuestApplication;
	assets: QuestAssets;
	colors: QuestColors;
	messages: QuestMessages;
	task_config: QuestTaskConfig;
	rewards_config: QuestRewardsConfig;
	share_policy: string;
}

export interface QuestApplication {
	id: string;
	name: string;
	link: string;
}

export interface QuestAssets {
	hero: string;
	hero_video: string;
	quest_bar_hero: string;
	quest_bar_hero_video: string;
	game_tile: string;
	logotype: string;
}

export interface QuestColors {
	primary: string;
	secondary: string;
}

export interface QuestMessages {
	quest_name: string;
	game_title: string;
	game_publisher: string;
}

export interface QuestTaskConfig {
	tasks: Record<QuestTaskType, QuestTask>;
	join_operator: string;
}

export interface QuestTask {
	type: string;
	target: number;
}

export interface QuestRewardsConfig {
	assignment_method: number;
	rewards: QuestReward[];
	rewards_expire_at: string;
	platforms: number[];
}

export interface QuestReward {
	type: QuestRewardType;
	sku_id: string;
	messages: {
		redemption_instructions_by_platform: Record<string, string>;
		name: string;
		name_with_article: string;
	};
	orb_quantity: number;
}

export interface QuestUserStatus {
	user_id: string;
	quest_id: string;
	enrolled_at: string;
	completed_at: string | null;
	claimed_at: string | null;
	claimed_tier: null;
	last_stream_heartbeat_at: string | null;
	stream_progress_seconds: number;
	dismissed_quest_content: number;
	progress: Record<string, QuestProgress>;
}

export interface QuestProgress {
	event_name: string;
	value: number;
	updated_at: string;
	completed_at: string | null;
	heartbeat: {
		last_beat_at: string;
		expires_at: string | null;
	} | null;
}

// ---- Enums ----

export type QuestTaskType =
	| "WATCH_VIDEO"
	| "WATCH_VIDEO_ON_MOBILE"
	| "PLAY_ON_DESKTOP"
	| "STREAM_ON_DESKTOP"
	| "PLAY_ACTIVITY";

export const enum QuestRewardType {
	CODE = 1,
	IN_GAME = 2,
	COLLECTIBLE = 3,
	VIRTUAL_CURRENCY = 4,
	FRACTIONAL_PREMIUM = 5,
}

// ---- Task Runner Types ----

export interface ActiveTask {
	questId: string;
	questName: string;
	taskType: QuestTaskType;
	cleanup: () => void;
}
