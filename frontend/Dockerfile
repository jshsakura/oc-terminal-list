# 빌드 스테이지
FROM node:18-alpine AS builder

WORKDIR /app

# 의존성 설치
COPY package.json package-lock.json* ./
RUN npm install

# 소스 복사 및 빌드
COPY . .
RUN npm run build

# 프로덕션 스테이지
FROM nginx:alpine

# Nginx 설정 복사
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 빌드된 정적 파일 복사
COPY --from=builder /app/dist /usr/share/nginx/html

# 포트 노출
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
