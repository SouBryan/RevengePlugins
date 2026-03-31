import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher as _FluxDispatcher } from "@vendetta/metro/common";

export const FluxDispatcher = _FluxDispatcher;

type StoreLike = {
	getName?: () => string;
	addChangeListener?: (listener: () => void) => void;
	removeChangeListener?: (listener: () => void) => void;
	[key: string]: any;
};

let cachedQuestsStore: StoreLike | undefined;
let cachedUserStore: StoreLike | undefined;
let cachedChannelStore: StoreLike | undefined;
let cachedGuildChannelStore: StoreLike | undefined;
let cachedRestAPI: any;
let cachedTokenModule: any;

function runtimeFind(filter: (m: any) => boolean): any {
	try {
		return (window as any)?.vendetta?.metro?.find?.(filter);
	} catch {
		return undefined;
	}
}

function runtimeFindAll(filter: (m: any) => boolean): any[] {
	try {
		return (window as any)?.vendetta?.metro?.findAll?.(filter) ?? [];
	} catch {
		return [];
	}
}

function resolveStore(
	name: string,
	fallback?: (m: any) => boolean,
): StoreLike | undefined {
	return findByStoreName(name)
		?? runtimeFind((m: any) => typeof m?.getName === "function" && m.getName() === name)
		?? (fallback ? runtimeFind(fallback) : undefined);
}

function isQuestStoreCandidate(m: any): boolean {
	if (!m || typeof m !== "object") return false;
	if (typeof m?.addChangeListener !== "function") return false;
	if (typeof m?.removeChangeListener !== "function") return false;

	const name = typeof m?.getName === "function" ? m.getName() : "";
	return /quest/i.test(name)
		|| m.quests != null
		|| typeof m.getQuest === "function"
		|| typeof m.getQuestById === "function"
		|| typeof m.getOptimisticProgress === "function";
}

export function getQuestsStore(): StoreLike | undefined {
	const resolved = resolveStore("QuestsStore", isQuestStoreCandidate);
	if (resolved) cachedQuestsStore = resolved;
	return resolved ?? cachedQuestsStore;
}

export function getUserStore(): StoreLike | undefined {
	const resolved = resolveStore("UserStore");
	if (resolved) cachedUserStore = resolved;
	return resolved ?? cachedUserStore;
}

export function getChannelStore(): StoreLike | undefined {
	const resolved = resolveStore("ChannelStore");
	if (resolved) cachedChannelStore = resolved;
	return resolved ?? cachedChannelStore;
}

export function getGuildChannelStore(): StoreLike | undefined {
	const resolved = resolveStore("GuildChannelStore");
	if (resolved) cachedGuildChannelStore = resolved;
	return resolved ?? cachedGuildChannelStore;
}

export function getRestAPI(): any {
	const resolved = findByProps("getAPIBaseURL")
		?? findByProps("get", "post", "put", "del");
	if (resolved) cachedRestAPI = resolved;
	return resolved ?? cachedRestAPI;
}

export function getTokenModule(): any {
	const resolved = findByProps("getToken");
	if (resolved) cachedTokenModule = resolved;
	return resolved ?? cachedTokenModule;
}

export function getQuestStoreDiagnostics(): string {
	const questStore = getQuestsStore();
	if (questStore) {
		const name = typeof questStore.getName === "function" ? questStore.getName() : "unknown";
		return `resolved=${name} keys=${Object.keys(questStore).slice(0, 20).join(",")}`;
	}

	const candidates = runtimeFindAll(isQuestStoreCandidate)
		.slice(0, 8)
		.map((candidate: any, index: number) => {
			const name = typeof candidate?.getName === "function"
				? candidate.getName()
				: `unnamed-${index + 1}`;
			const keys = Object.keys(candidate ?? {}).slice(0, 12).join(",");
			return `${name}[${keys}]`;
		});

	return candidates.length > 0
		? `resolved=none candidates=${candidates.join(" | ")}`
		: "resolved=none candidates=none";
}
