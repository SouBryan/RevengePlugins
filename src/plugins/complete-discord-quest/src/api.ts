import { ChannelStore, RestAPI, TokenModule } from "./stores";
import type { Quest } from "./types";

const API_BASE = "https://discord.com/api/v9";

const DESKTOP_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9188 Chrome/130.0.6723.191 Electron/33.3.1 Safari/537.36";

function buildSuperProperties(): string {
	const props = {
		os: "Windows",
		browser: "Discord Client",
		release_channel: "stable",
		client_version: "1.0.9188",
		os_version: "10.0.22631",
		os_arch: "x64",
		app_arch: "x64",
		system_locale: "en-US",
		browser_user_agent: DESKTOP_USER_AGENT,
		browser_version: "33.3.1",
		client_build_number: 366934,
		native_build_number: null,
		client_event_source: null,
	};
	return btoa(JSON.stringify(props));
}

function getSpoofHeaders(): Record<string, string> {
	return {
		"User-Agent": DESKTOP_USER_AGENT,
		"X-Super-Properties": buildSuperProperties(),
		"X-Discord-Locale": "en-US",
		"X-Discord-Timezone": Intl?.DateTimeFormat?.().resolvedOptions?.()?.timeZone ?? "America/Sao_Paulo",
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
	const body = { stream_key: streamKey, terminal };

	// Strategy 1: Use RestAPI.post with custom headers (token is auto-injected)
	try {
		const resp = await RestAPI.post({
			url: `/quests/${questId}/heartbeat`,
			body,
			headers: getSpoofHeaders(),
		});
		console.log(`[CompleteDiscordQuest] Heartbeat OK via RestAPI (strategy 1)`);
		return resp.body;
	} catch (e: any) {
		const status = e?.status ?? e?.httpStatus ?? e?.body?.code;
		console.log(`[CompleteDiscordQuest] Strategy 1 (RestAPI+headers) failed: status=${status}, message=${e?.message ?? e?.body?.message ?? JSON.stringify(e)}`);

		// If it's rate limited, throw immediately
		if (status === 429) {
			const retryAfter = e?.body?.retry_after ?? 60;
			throw new RateLimitError(retryAfter);
		}
	}

	// Strategy 2: Use raw fetch with manual token
	try {
		const token = TokenModule?.getToken?.();
		if (!token) throw new Error("No token");

		console.log(`[CompleteDiscordQuest] Trying strategy 2 (fetch), token starts with: ${token.substring(0, 10)}...`);

		const headers: Record<string, string> = {
			...getSpoofHeaders(),
			Authorization: token,
			"Content-Type": "application/json",
		};

		const resp = await fetch(`${API_BASE}/quests/${questId}/heartbeat`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});

		if (resp.status === 204) {
			console.log(`[CompleteDiscordQuest] Heartbeat OK via fetch (strategy 2)`);
			return {};
		}

		let data: any = {};
		try {
			data = await resp.json();
		} catch {
			// no json body
		}

		if (resp.ok) {
			console.log(`[CompleteDiscordQuest] Heartbeat OK via fetch (strategy 2)`);
			return data;
		}

		console.log(`[CompleteDiscordQuest] Strategy 2 (fetch) failed: HTTP ${resp.status}, body=${JSON.stringify(data)}`);

		if (resp.status === 429) {
			throw new RateLimitError(data?.retry_after ?? 60);
		}
		if (resp.status === 401 || resp.status === 403) {
			throw new AuthError(`HTTP ${resp.status}: ${JSON.stringify(data)}`);
		}
		throw new Error(`HTTP ${resp.status}: ${JSON.stringify(data)}`);
	} catch (e) {
		if (e instanceof RateLimitError || e instanceof AuthError) throw e;
		console.error(`[CompleteDiscordQuest] Strategy 2 (fetch) exception:`, e);
		throw e;
	}
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
	constructor(detail?: string) {
		super(detail ?? "Authentication failed (401/403)");
	}
}
