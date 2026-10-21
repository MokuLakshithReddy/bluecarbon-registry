-- ==============================================================================
-- Migration: Revoke PUBLIC Execute Grants on Privileged SECURITY DEFINER Functions
-- Audit Reference: Milestone 1 — Security Baseline & RPC Authorization Boundaries
-- ==============================================================================

-- 1. SIWE NONCE CONSUMPTION FUNCTION
-- Prevents unauthenticated / public callers from invoking consume_siwe_nonce
REVOKE EXECUTE ON FUNCTION public.consume_siwe_nonce(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_siwe_nonce(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_siwe_nonce(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_siwe_nonce(text, text) TO service_role;

-- 2. KYC CUMULATIVE VOLUME FUNCTION
-- Restricts get_cumulative_annual_volume to service_role and authenticated users
REVOKE EXECUTE ON FUNCTION public.get_cumulative_annual_volume(text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_cumulative_annual_volume(text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_cumulative_annual_volume(text, timestamptz) TO authenticated, service_role;

-- 3. KYC COMPLIANCE RECORDING FUNCTION
-- Restricts record_compliance_transaction exclusively to service_role and authenticated users
REVOKE EXECUTE ON FUNCTION public.record_compliance_transaction(text, text, bigint, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_compliance_transaction(text, text, bigint, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_compliance_transaction(text, text, bigint, timestamptz) TO authenticated, service_role;
