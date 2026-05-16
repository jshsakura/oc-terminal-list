import time

import pytest

import main


def setup_function():
    main._ws_tickets.clear()
    main._file_tickets.clear()


def teardown_function():
    main._ws_tickets.clear()
    main._file_tickets.clear()


def test_ws_ticket_is_single_use_and_path_bound():
    ticket, _expires_at = main._create_ws_ticket("admin", "/ws/session-1")

    assert main._consume_ws_ticket(ticket, "/ws/session-2") is None
    assert main._consume_ws_ticket(ticket, "/ws/session-1") is None

    ticket, _expires_at = main._create_ws_ticket("admin", "/ws/session-1")
    assert main._consume_ws_ticket(ticket, "/ws/session-1") == "admin"
    assert main._consume_ws_ticket(ticket, "/ws/session-1") is None


def test_ws_ticket_rejects_expired_ticket():
    ticket, _expires_at = main._create_ws_ticket("admin", "/ws/session-1")
    main._ws_tickets[ticket]["expires_at"] = time.time() - 1

    assert main._consume_ws_ticket(ticket, "/ws/session-1") is None


def test_ws_ticket_rejects_non_ws_paths():
    with pytest.raises(main.HTTPException):
        main._create_ws_ticket("admin", "/api/sessions")


def test_file_ticket_is_single_use(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))
    target = tmp_path / "preview.png"
    target.write_bytes(b"image")

    ticket, _expires_at = main._create_file_ticket("admin", "preview.png")

    assert main._consume_file_ticket(ticket) == str(target)
    assert main._consume_file_ticket(ticket) is None


def test_file_ticket_rejects_expired_ticket(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))
    target = tmp_path / "preview.png"
    target.write_bytes(b"image")
    ticket, _expires_at = main._create_file_ticket("admin", "preview.png")
    main._file_tickets[ticket]["expires_at"] = time.time() - 1

    assert main._consume_file_ticket(ticket) is None


def test_validate_path_preserves_literal_dotdot_in_filename(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))

    assert main.validate_path("a..b.txt") == tmp_path.resolve() / "a..b.txt"


def test_validate_path_clamps_parent_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))

    assert main.validate_path("../outside.txt") == tmp_path.resolve()


def test_validate_path_clamps_symlink_escape(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "WORKSPACE_ROOT", str(tmp_path))
    monkeypatch.setattr("_deps.WORKSPACE_ROOT", str(tmp_path))
    outside = tmp_path.parent / "outside-target"
    outside.mkdir(exist_ok=True)
    link = tmp_path / "link"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlinks are not available on this filesystem")

    assert main.validate_path("link/secret.txt") == tmp_path.resolve()
