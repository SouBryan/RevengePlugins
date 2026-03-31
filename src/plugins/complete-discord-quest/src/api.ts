import {
	FluxDispatcher,
	getChannelStore,
	getRestAPI,
	getTokenModule,
} from "./stores";
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
		"X-Discord-Timezone": Intl?.DateTimeFormat?.().resolvedOptions?.()?.timeZone
			?? "America/Sao_Paulo",
	};
}

// ---- Try to find Discord's internal quest enrollment action at runtime ----
let _questEnrollAction: ((questId: string, action: any) => Promise<any>) | null = null;

function findQuestEnrollAction(): typeof _questEnrollAction {
	if (_questEnrollAction) return _questEnrollAction;
	try {
		// vendetta.metro.find takes a filter function and returns matching module
		const vd = (window as any).vendetta;
		if (vd?.metro?.find) {
			const mod = vd.metro.find((m: any) => {
				if (typeof m !== "function" && typeof m !== "object") return false;
				// Look for modules that have quest-related methods
				if (typeof m?.default === "function") {
					try {
						const src = m.default.toString();
						if (src.includes("QUESTS_ENROLL") || src.includes("quests") && src.includes("enroll")) {
							return true;
						}
					} catch {}
				}
				return false;
			});
			if (mod?.default && typeof mod.default === "function") {
				_questEnrollAction = mod.default;
				console.log("[CompleteDiscordQuest] Found internal quest enroll action");
			}
		}
	} catch (e) {
		console.log("[CompleteDiscordQuest] Could not find internal quest enroll action:", e);
	}
	return _questEnrollAction;
}

// ---- REST via native Discord module ----

export async function getQuests(): Promise<{ quests: Quest[] }> {
	const restAPI = getRestAPI();
	if (!restAPI) throw new Error("Discord RestAPI module not found");
	const resp = await restAPI.get({ url: "/quests/@me" });
	return resp.body;
}

export async function enrollQuest(questId: string): Promise<any> {
	// Strategy 0: Try Discord's internal enrollment action (Flux-based)
	const internalAction = findQuestEnrollAction();
	if (internalAction) {
		try {
			const result = await internalAction(questId, {
				questContent: 11,
				questContentCTA: "ACCEPT_QUEST",
				sourceQuestContent: 0,
			});
			console.log(`[CompleteDiscordQuest] Enrolled ${questId} via internal action`);
			return result;
		} catch (e: any) {
			console.log(`[CompleteDiscordQuest] Internal enroll failed for ${questId}: ${e?.message ?? e}`);
		}
	}

	// Strategy 1: RestAPI native (mobile-style, no header spoofing)
	try {
		const restAPI = getRestAPI();
		if (!restAPI) throw new Error("Discord RestAPI module not found");
		const resp = await restAPI.post({
			url: `/quests/${questId}/enroll`,
			body: { location: "11" },
		});
		console.log(`[CompleteDiscordQuest] Enrolled ${questId} via RestAPI native`);
		return resp.body;
	} catch (e: any) {
		console.log(`[CompleteDiscordQuest] Enroll strategy 1 (RestAPI native) failed for ${questId}: ${e?.status ?? e?.httpStatus} ${e?.body?.message ?? e?.message ?? ""}`);
	}

	// Strategy 2: RestAPI with desktop spoof headers
	try {
		const restAPI = getRestAPI();
		if (!restAPI) throw new Error("Discord RestAPI module not found");
		const resp = await restAPI.post({
			url: `/quests/${questId}/enroll`,
			body: { location: "11" },
			headers: getSpoofHeaders(),
		});
		console.log(`[CompleteDiscordQuest] Enrolled ${questId} via RestAPI+spoof`);
		return resp.body;
	} catch (e: any) {
		console.log(`[CompleteDiscordQuest] Enroll strategy 2 (RestAPI+spoof) failed for ${questId}: ${e?.status ?? e?.httpStatus} ${e?.body?.message ?? e?.message ?? ""}`);
	}

	// Strategy 3: fetch with full desktop headers
	try {
		const token = getTokenModule()?.getToken?.();
		if (!token) throw new Error("No token");

		const resp = await fetch(`${API_BASE}/quests/${questId}/enroll`, {
			method: "POST",
			headers: {
				...getSpoofHeaders(),
				Authorization: token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ location: "11" }),
		});

		let data: any = {};
		try { data = await resp.json(); } catch {}

		if (resp.ok) {
			console.log(`[CompleteDiscordQuest] Enrolled ${questId} via fetch`);
			return data;
		}
		console.log(`[CompleteDiscordQuest] Enroll strategy 3 (fetch) failed for ${questId}: HTTP ${resp.status} ${JSON.stringify(data)}`);
	} catch (e: any) {
		console.log(`[CompleteDiscordQuest] Enroll strategy 3 exception for ${questId}: ${e?.message ?? e}`);
	}

	// Strategy 4: Flux dispatch (trigger Discord's own enrollment handler)
	try {
		await FluxDispatcher.dispatch({
			type: "QUESTS_SEND_ENROLL",
			questId,
			location: 11,
		});
		console.log(`[CompleteDiscordQuest] Dispatched QUESTS_SEND_ENROLL for ${questId}`);
		// Wait a bit for the enrollment to be processed
		await new Promise(r => setTimeout(r, 2000));
		return {};
	} catch (e: any) {
		console.log(`[CompleteDiscordQuest] Flux dispatch failed for ${questId}: ${e?.message ?? e}`);
	}

	throw new Error("All enrollment strategies failed");
}

export async function sendVideoProgress(
	questId: string,
	timestamp: number,
): Promise<any> {
	const restAPI = getRestAPI();
	if (!restAPI) throw new Error("Discord RestAPI module not found");
	const resp = await restAPI.post({
		url: `/quests/${questId}/video-progress`,
		body: { timestamp },
	});
	return resp.body;
}

export async function getPublicApplication(applicationId: string): Promise<any | null> {
	const restAPI = getRestAPI();
	if (!restAPI) throw new Error("Discord RestAPI module not found");
	const resp = await restAPI.get({
		url: `/applications/public?application_ids=${applicationId}`,
	});
	return resp?.body?.[0] ?? null;
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
		const restAPI = getRestAPI();
		if (!restAPI) throw new Error("Discord RestAPI module not found");
		const resp = await restAPI.post({
			url: `/quests/${questId}/heartbeat`,
			body,
			headers: getSpoofHeaders(),
		});
		console.log(`[CompleteDiscordQuest] Heartbeat OK via RestAPI (strategy 1)`);
		return resp.body;
	} catch (e: any) {
		const status = e?.status ?? e?.httpStatus ?? e?.body?.code;
		console.log(
			`[CompleteDiscordQuest] Strategy 1 (RestAPI+headers) failed: status=${status}, message=${
				e?.message ?? e?.body?.message ?? JSON.stringify(e)
			}`,
		);

		// If it's rate limited, throw immediately
		if (status === 429) {
			const retryAfter = e?.body?.retry_after ?? 60;
			throw new RateLimitError(retryAfter);
		}
	}

	// Strategy 2: Use raw fetch with manual token
	try {
		const token = getTokenModule()?.getToken?.();
		if (!token) throw new Error("No token");

		console.log(
			`[CompleteDiscordQuest] Trying strategy 2 (fetch), token starts with: ${
				token.substring(0, 10)
			}...`,
		);

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

		console.log(
			`[CompleteDiscordQuest] Strategy 2 (fetch) failed: HTTP ${resp.status}, body=${
				JSON.stringify(data)
			}`,
		);

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
	const restAPI = getRestAPI();
	if (!restAPI) throw new Error("Discord RestAPI module not found");
	const resp = await restAPI.post({
		url: `/quests/${questId}/heartbeat`,
		body: { stream_key: streamKey, terminal },
	});
	return resp.body;
}

// ---- Utilities ----

export function findStreamKey(): string {
	// Try to find a DM channel or voice channel ID for the stream_key
	try {
		const privateChannels = getChannelStore()?.getSortedPrivateChannels?.();
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
