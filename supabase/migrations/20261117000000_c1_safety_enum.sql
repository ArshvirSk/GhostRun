-- Migration: 20261117000000_c1_safety_enum.sql
-- Phase C Milestone C1: Speed & Safety Guard - Add 'paused' to public.game_status enum

alter type public.game_status add value if not exists 'paused';
