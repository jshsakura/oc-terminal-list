import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    /* 이 스위트는 **다른 사람이 쓰고 있는 기계**에서 돈다. 이 개발 박스는 코어가 4개인데
       그 위에 QEMU·Chrome(playwright)·java 와 에이전트 세션 십수 개가 상주한다. 제한 없이
       돌리면 vitest 가 코어를 전부 가져가고(105 파일 × jsdom), 그동안 다른 세션은 명령
       하나 띄우는 것조차 타임아웃된다 — 실제로 그렇게 옆 세션의 셸이 죽었고, 이 스위트
       자신도 90초에서 232초로 늘어지며 시간에 민감한 테스트가 깜빡였다.

       느려지는 만큼이 아니라 **기계가 계속 쓸 만한가**를 산다. 전용 러너(CI)에서는
       VITEST_MAX_THREADS 로 올리면 된다. */
    poolOptions: {
      threads: {
        maxThreads: Number(process.env.VITEST_MAX_THREADS) || 2,
        minThreads: 1,
      },
    },
  },
});
