import { requestUrl } from "obsidian";
import { HttpTransport } from "./api";

export const obsidianTransport: HttpTransport = async (req) => {
  const method = req.body === "" ? "GET" : "POST";
  const options: Parameters<typeof requestUrl>[0] = {
    url: req.url,
    method,
    headers: { ...req.headers },
    throw: false,
  };
  if (req.body !== "") options.body = req.body;
  const res = await requestUrl(options);
  return { status: res.status, body: typeof res.text === "string" ? res.text : "" };
};
