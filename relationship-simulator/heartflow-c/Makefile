# 通用构建（有 gcc/clang 时用它；Windows 需要 -lshell32）
CC      ?= cc
CFLAGS  ?= -O2 -std=c11 -Wall -Wextra -Isrc
LDFLAGS ?=
SRC     := $(wildcard src/*.c)
BIN     := hf

UNAME := $(shell uname -s 2>/dev/null)
ifneq (,$(findstring MINGW,$(UNAME)))
  LDFLAGS += -lshell32
  BIN := hf.exe
endif

all: $(BIN)

$(BIN): $(SRC) src/hf.h
	$(CC) $(CFLAGS) -o $(BIN) $(SRC) $(LDFLAGS)

clean:
	rm -f hf hf.exe

.PHONY: all clean
