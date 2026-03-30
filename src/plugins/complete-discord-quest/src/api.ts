import { TokenModule, RestAPI, ChannelStore } from "./stores";
import type { Quest } from "./types";

const API_BASE = "https://discord.com/api/v9";

const DESKTOP_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Discord/1.0.0 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36";

function buildSuperProperties(): string {
	const props = {
		os: "Windows",
		browser: "Discord Client",
		release_channel: "stable",
		client_build_number: 512709,
		os_version: "10.0.22631",
		os_arch: "x64",
		app_arch: "x64",
		system_locale: "en-US",
		browser_user_agent: DESKTOP_USER_AGENT,
		browser_version: "28.0.0",
		client_event_source: null,
	};
	// btoa is available in React Native
	return btoa(JSON.stringify(props));
}

function buildDesktopHeaders(): Record<string, string> {
	const token = TokenModule?.getToken?.();
	if (!token) throw new Error("No auth token available");

	return {
		Authorization: token,
		"User-Agent": DESKTOP_USER_AGENT,
		"Content-Type": "application/json",
		"X-Super-Properties": buildSuperProperties(),
		"X-Discord-Locale": "en-US",
		"X-Discord-Timezone": "America/Sao_Paulo",
	};
}

// ---- REST via native Discord module (mobile headers — fine for video/activity) ----

export async function getQuests(): Promise<{ quests: Quest[] }> {
	const resp = await RestAPI.get({ url: "/quests/@me" });
	return resp.body;
}

export async function enrollQuest(questId: string): Promise<any> {
	const resp = await RestAPI.post({
		url: `/quests/${questId}/enroll`,
		body: { location: 11 },
	});
	return resp.body;
}

export async function sendVideoProgress(
	questId: string,
	timestamp: number,
): Promise<any> {
	const resp = await RestAPI.post({
		url: `/quests/${questId}/video-progress`,
		body: { timestamp },
	});
	return resp.body;
}

// ---- REST via fetch with spoofed desktop headers (for game/stream quests) ----

export async function sendHeartbeat(
	questId: string,
	streamKey: string,
	terminal: boolean,
): Promise<any> {
	const resp = await fetch(`${API_BASE}/quests/${questId}/heartbeat`, {
		method: "POST",
		headers: buildDesktopHeaders(),
		body: JSON.stringify({ stream_key: streamKey, terminal }),
	});

	if (resp.status === 204) return {};

	const data = await resp.json();

	if (!resp.ok) {
		if (resp.status === 429) {
			const retryAfter = data?.retry_after ?? 60;
			throw new RateLimitError(retryAfter);
		}
		if (resp.status === 401 || resp.status === 403) {
			throw new AuthError();
		}
		throw new Error(`HTTP ${resp.status}: ${JSON.stringify(data)}`);
	}

	return data;
}

// Also provide a spoofed heartbeat for PLAY_ACTIVITY if needed as fallback
export async function sendHeartbeatNative(
	questId: string,
	streamKey: string,
	terminal: boolean,
): Promise<any> {
	const resp = await RestAPI.post({
		url: `/quests/${questId}/heartbeat`,
		body: { stream_key: streamKey, terminal },
	});
	return resp.body;
}

// ---- Utilities ----

export function findStreamKey(): string {
	// Try to find a DM channel or voice channel ID for the stream_key
	try {
		const privateChannels = ChannelStore?.getSortedPrivateChannels?.();
		if (privateChannels?.length > 0) {
			return `call:${privateChannels[0].id}:1`;
		}
	} catch {
		// ignore
	}

	// Fallback: use a generic key
	return "call:0:1";
}

export class RateLimitError extends Error {
	retryAfter: number;

	constructor(retryAfter: number) {
		super(`Rate limited, retry after ${retryAfter}s`);
		this.retryAfter = retryAfter;
	}
}

export class AuthError extends Error {
	constructor() {
		super("Authentication failed (401/403)");
	}
}
