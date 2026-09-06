from vault import encrypt_str, decrypt_str, reencrypt_legacy

def test_encrypt_decrypt_roundtrip():
    original = "secret_password_123"
    encrypted = encrypt_str(original)
    assert encrypted is not None
    assert encrypted != original
    
    decrypted = decrypt_str(encrypted)
    assert decrypted == original

def test_encrypt_none_or_empty():
    assert encrypt_str(None) is None
    assert encrypt_str("") is None

def test_decrypt_none_or_empty():
    assert decrypt_str(None) is None
    assert decrypt_str("") is None

def test_reencrypt_legacy_no_op_for_v2():
    # v2 encrypted string should not be changed by reencrypt_legacy
    val = "some_val"
    enc = encrypt_str(val)
    assert reencrypt_legacy(enc) is None
