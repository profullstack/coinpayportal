-- RLS policies for OIDC provider tables

-- oauth_clients: owners can manage their own clients
CREATE POLICY "owners_select_own_clients" ON oauth_clients
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "owners_update_own_clients" ON oauth_clients
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "owners_delete_own_clients" ON oauth_clients
  FOR DELETE USING (auth.uid() = owner_id);

CREATE POLICY "owners_insert_clients" ON oauth_clients
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "service_role_all_clients" ON oauth_clients
  FOR ALL USING (auth.role() = 'service_role');

-- oauth_authorization_codes: users can only see their own codes
CREATE POLICY "users_select_own_codes" ON oauth_authorization_codes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_all_codes" ON oauth_authorization_codes
  FOR ALL USING (auth.role() = 'service_role');

-- oauth_refresh_tokens: users can only see their own tokens
CREATE POLICY "users_select_own_tokens" ON oauth_refresh_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_all_tokens" ON oauth_refresh_tokens
  FOR ALL USING (auth.role() = 'service_role');

-- oauth_consents: users can select and delete their own consents
CREATE POLICY "users_select_own_consents" ON oauth_consents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_delete_own_consents" ON oauth_consents
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "service_role_all_consents" ON oauth_consents
  FOR ALL USING (auth.role() = 'service_role');
