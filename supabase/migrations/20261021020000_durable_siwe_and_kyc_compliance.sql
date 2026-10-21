-- ==============================================================================
-- Migration: Durable SIWE Nonce Store & KYC Compliance Ledger
-- Audit Reference: Findings 2 & 3 (Shared Atomic Persistence for Multi-Worker / Serverless)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SIWE NONCES TABLE & ATOMIC CONSUMPTION
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.siwe_nonces (
  nonce text PRIMARY KEY,
  bound_address text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.siwe_nonces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access to siwe_nonces" ON public.siwe_nonces;
CREATE POLICY "service_role full access to siwe_nonces" ON public.siwe_nonces
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Atomic server-side consumption preventing double-spend / replay attacks across distributed workers
CREATE OR REPLACE FUNCTION public.consume_siwe_nonce(
  p_nonce text,
  p_address text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.siwe_nonces
  SET consumed_at = now()
  WHERE nonce = p_nonce
    AND consumed_at IS NULL
    AND expires_at > now()
    AND (bound_address IS NULL OR lower(bound_address) = lower(p_address));
    
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. KYC COMPLIANCE TRANSACTIONS TABLE & CUMULATIVE AGGREGATION
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kyc_compliance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL,
  action text NOT NULL,
  amount_milli_tco2e bigint NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyc_compliance_wallet_time 
  ON public.kyc_compliance_transactions (lower(wallet_address), timestamp);

ALTER TABLE public.kyc_compliance_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access to kyc_transactions" ON public.kyc_compliance_transactions;
CREATE POLICY "service_role full access to kyc_transactions" ON public.kyc_compliance_transactions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Durable rolling 365-day cumulative volume query
CREATE OR REPLACE FUNCTION public.get_cumulative_annual_volume(
  p_wallet_address text,
  p_as_of timestamptz DEFAULT now()
) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(amount_milli_tco2e), 0)::bigint
  FROM public.kyc_compliance_transactions
  WHERE lower(wallet_address) = lower(p_wallet_address)
    AND timestamp >= (p_as_of - interval '365 days')
    AND timestamp <= p_as_of;
$$;

-- Atomic insertion of compliant transaction
CREATE OR REPLACE FUNCTION public.record_compliance_transaction(
  p_wallet_address text,
  p_action text,
  p_amount_milli_tco2e bigint,
  p_timestamp timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.kyc_compliance_transactions (wallet_address, action, amount_milli_tco2e, timestamp)
  VALUES (lower(p_wallet_address), p_action, p_amount_milli_tco2e, p_timestamp)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
