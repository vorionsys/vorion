import OpenAI from 'openai'
import type { ChatCompletionCreateParams, ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions'
import { config } from '@/lib/config'

let client: OpenAI | null = null

export function getXaiClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.xai.apiKey,
      baseURL: config.xai.baseUrl,
    })
  }
  return client
}

export const DEFAULT_XAI_MODEL = config.xai.defaultModel

export async function createXaiChatCompletion(
  params: ChatCompletionCreateParamsNonStreaming
) {
  const xai = getXaiClient()
  return xai.chat.completions.create(params)
}

export async function streamXaiChatCompletion(
  params: ChatCompletionCreateParamsStreaming
) {
  const xai = getXaiClient()
  return xai.chat.completions.create(params)
}

export type XaiChatCompletionParams = ChatCompletionCreateParams
