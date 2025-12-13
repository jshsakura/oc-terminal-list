"""
Redis 클라이언트: 터미널 세션 히스토리 및 메타데이터 관리
"""
import os
from typing import List, Optional
import redis.asyncio as aioredis
import logging

logger = logging.getLogger(__name__)


class RedisClient:
    """비동기 Redis 클라이언트 - 세션 영속성 관리"""

    def __init__(self):
        redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:36379")
        self.redis: Optional[aioredis.Redis] = None
        self.redis_url = redis_url
        logger.info(f"Redis 클라이언트 초기화: {redis_url}")

    async def connect(self):
        """Redis 연결 초기화"""
        try:
            self.redis = await aioredis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
            await self.redis.ping()
            logger.info("Redis 연결 성공")
        except Exception as e:
            logger.error(f"Redis 연결 실패: {e}")
            raise

    async def close(self):
        """Redis 연결 종료"""
        if self.redis:
            await self.redis.close()
            logger.info("Redis 연결 종료")

    async def append_output(self, session_id: str, data: str):
        """
        터미널 출력을 세션 히스토리에 추가

        Args:
            session_id: 세션 ID
            data: 터미널 출력 데이터
        """
        if not self.redis:
            return

        try:
            key = f"session:{session_id}:history"

            # 리스트에 추가
            await self.redis.rpush(key, data)

            # 최근 10000개 엔트리만 유지 (메모리 관리)
            await self.redis.ltrim(key, -10000, -1)

            # TTL 1시간 (3600초)
            await self.redis.expire(key, 3600)

            # 마지막 활동 시간 업데이트
            await self.update_session_meta(session_id)

        except Exception as e:
            logger.error(f"Redis 출력 저장 실패 (session: {session_id}): {e}")

    async def get_history(self, session_id: str) -> List[str]:
        """
        세션의 전체 히스토리 조회

        Args:
            session_id: 세션 ID

        Returns:
            터미널 출력 히스토리 리스트
        """
        if not self.redis:
            return []

        try:
            key = f"session:{session_id}:history"
            history = await self.redis.lrange(key, 0, -1)
            return history if history else []
        except Exception as e:
            logger.error(f"Redis 히스토리 조회 실패 (session: {session_id}): {e}")
            return []

    async def clear_history(self, session_id: str):
        """
        세션 히스토리 삭제

        Args:
            session_id: 세션 ID
        """
        if not self.redis:
            return

        try:
            key = f"session:{session_id}:history"
            await self.redis.delete(key)
            logger.info(f"세션 히스토리 삭제됨: {session_id}")
        except Exception as e:
            logger.error(f"Redis 히스토리 삭제 실패 (session: {session_id}): {e}")

    async def update_session_meta(self, session_id: str):
        """
        세션 메타데이터 업데이트 (마지막 활동 시간)

        Args:
            session_id: 세션 ID
        """
        if not self.redis:
            return

        try:
            import time
            key = f"session:{session_id}:meta"
            meta = {
                "last_activity": str(int(time.time())),
                "session_id": session_id
            }

            await self.redis.hset(key, mapping=meta)
            await self.redis.expire(key, 3600)
        except Exception as e:
            logger.error(f"세션 메타 업데이트 실패 (session: {session_id}): {e}")

    async def get_session_meta(self, session_id: str) -> dict:
        """
        세션 메타데이터 조회

        Args:
            session_id: 세션 ID

        Returns:
            세션 메타데이터 딕셔너리
        """
        if not self.redis:
            return {}

        try:
            key = f"session:{session_id}:meta"
            meta = await self.redis.hgetall(key)
            return meta if meta else {}
        except Exception as e:
            logger.error(f"세션 메타 조회 실패 (session: {session_id}): {e}")
            return {}

    async def list_active_sessions(self) -> List[str]:
        """
        활성 세션 목록 조회

        Returns:
            세션 ID 리스트
        """
        if not self.redis:
            return []

        try:
            # session:*:meta 키 패턴으로 검색
            keys = await self.redis.keys("session:*:meta")
            session_ids = [key.split(":")[1] for key in keys]
            return session_ids
        except Exception as e:
            logger.error(f"활성 세션 목록 조회 실패: {e}")
            return []


# 전역 Redis 클라이언트 인스턴스
redis_client = RedisClient()
