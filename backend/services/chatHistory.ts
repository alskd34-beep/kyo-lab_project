/**
 * [BACKEND] Chat History 서비스 - Supabase에 대화 이력 저장/조회
 */

import { supabase } from '@backend/lib/supabase'

export interface StoredMessage {
  id: string
  role: 'user' | 'bot'
  content: string
  createdAt: string
}

export interface StoredConversation {
  id: string
  difyConvId: string | null
  title: string | null
  updatedAt: string
}

/** Dify conversation_id로 내부 대화 row를 가져오거나 새로 생성합니다. */
export async function upsertConversation(params: {
  difyConvId: string
  userKey: string
  title?: string
}): Promise<string> {
  const { data: existing } = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('dify_conv_id', params.difyConvId)
    .eq('user_key', params.userKey)
    .maybeSingle()

  if (existing?.id) return existing.id as string

  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({
      dify_conv_id: params.difyConvId,
      user_key:     params.userKey,
      title:        params.title ?? null,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}

export async function appendMessage(params: {
  conversationId: string
  role: 'user' | 'bot'
  content: string
}): Promise<void> {
  const { error } = await supabase.from('chat_messages').insert({
    conversation_id: params.conversationId,
    role:            params.role,
    content:         params.content,
  })
  if (error) throw error
}

export async function listConversations(userKey: string): Promise<StoredConversation[]> {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('id, dify_conv_id, title, updated_at')
    .eq('user_key', userKey)
    .order('updated_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data ?? []).map(r => ({
    id:         r.id as string,
    difyConvId: (r.dify_conv_id as string | null) ?? null,
    title:      (r.title as string | null) ?? null,
    updatedAt:  r.updated_at as string,
  }))
}

export async function getMessages(conversationId: string, userKey: string): Promise<StoredMessage[]> {
  const { data: conversation, error: conversationError } = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_key', userKey)
    .maybeSingle()
  if (conversationError) throw conversationError
  if (!conversation) throw new Error('대화를 찾을 수 없습니다.')

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => ({
    id:        r.id as string,
    role:      r.role as 'user' | 'bot',
    content:   r.content as string,
    createdAt: r.created_at as string,
  }))
}

/** 사용자의 모든 대화와 하위 메시지를 삭제합니다. */
export async function deleteConversations(userKey: string): Promise<void> {
  const { error } = await supabase
    .from('chat_conversations')
    .delete()
    .eq('user_key', userKey)

  if (error) throw error
}
