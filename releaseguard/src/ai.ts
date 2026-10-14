// One small wrapper around Groq's OpenAI-compatible chat endpoint.
import { env } from "./config.js";

export async function askJSON<T>(system: string, user: string): Promise<T> {
  const text = await chat(system, user, true);
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  return JSON.parse(cleaned) as T;
}

export async function askText(system: string, user: string): Promise<string> {
  return chat(system, user, false);
}

async function chat(system: string, user: string, json: boolean): Promise<string> {
  if (!env.groqKey) throw new Error("GROQ_API_KEY missing in .env");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.groqKey}` },
    body: JSON.stringify({
      model: env.groqModel,
      temperature: 0.1,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}
