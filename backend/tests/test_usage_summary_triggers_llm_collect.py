"""The home screen's usage fetch is the daily LLM collection trigger.

POST /api/sessions used to be the only other trigger, but terminals now open over
the WS route, so collection silently stopped for a month (2026-10-22 → 11-19).
"""
import asyncio
from unittest.mock import AsyncMock, patch

from routes import system


def test_usage_summary_kicks_llm_collection():
    # Arrange
    collect = AsyncMock()
    summary = AsyncMock(return_value={"ok": True})

    # Act
    with patch.object(system, "maybe_collect_in_background", collect), \
         patch.object(system.storage, "get_usage_summary", summary):
        result = asyncio.run(system.get_usage_summary(days=7, username="alice"))

    # Assert
    collect.assert_awaited_once_with("alice")
    assert result == {"ok": True}
