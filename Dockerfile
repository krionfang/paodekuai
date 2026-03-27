FROM python:3.11-slim

ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render 会通过 PORT 环境变量动态分配端口
ENV PORT=8000
EXPOSE ${PORT}

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
