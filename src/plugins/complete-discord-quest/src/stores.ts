import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher as _FluxDispatcher } from "@vendetta/metro/common";

export const FluxDispatcher = _FluxDispatcher;

export const QuestsStore = findByStoreName("QuestsStore");

export const UserStore = findByStoreName("UserStore");

export const ChannelStore = findByStoreName("ChannelStore");

export const GuildChannelStore = findByStoreName("GuildChannelStore");

// Discord internal REST module — fallback signatures for different Discord versions
export const RestAPI =
	findByProps("getAPIBaseURL") ??
	findByProps("get", "post", "put", "del");

// Token access for spoofed desktop requests
export const TokenModule = findByProps("getToken");
