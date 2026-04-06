const { v4: uuidv4 } = require('uuid');

class GameService {
  constructor() {
    this.games = new Map(); // gameId -> gameState
  }

  createGame(player1Id, player2Id, gameType = 'tictactoe') {
    const gameId = uuidv4();
    const gameState = {
      gameId,
      gameType,
      players: [player1Id, player2Id],
      board: Array(9).fill(""),
      currentTurn: player1Id,
      winner: null,
      status: "waiting",
      createdAt: Date.now(),
      moves: 0
    };
    this.games.set(gameId, gameState);
    return gameState;
  }

  getGame(gameId) {
    return this.games.get(gameId);
  }

  joinGame(gameId, playerId) {
    const game = this.games.get(gameId);
    if (!game) return null;
    
    if (game.players.includes(playerId)) {
      game.status = "playing";
      return game;
    }
    return null;
  }

  makeMove(gameId, playerId, position) {
    const game = this.games.get(gameId);
    if (!game || game.status !== "playing" || game.winner) return { error: "Invalid game state" };
    if (game.currentTurn !== playerId) return { error: "Not your turn" };
    if (game.board[position] !== "") return { error: "Already occupied" };

    const symbol = game.players[0] === playerId ? "X" : "O";
    game.board[position] = symbol;
    game.moves++;
    
    const winner = this.checkWinner(game.board);
    if (winner) {
      game.winner = playerId;
      game.status = "finished";
    } else if (game.moves === 9) {
      game.winner = "draw";
      game.status = "finished";
    } else {
      game.currentTurn = game.players.find(p => p !== playerId);
    }

    return { game };
  }

  checkWinner(board) {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
      [0, 4, 8], [2, 4, 6]             // diags
    ];

    for (let line of lines) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }
    return null;
  }

  leaveGame(gameId, playerId) {
    const game = this.games.get(gameId);
    if (game && game.status === "playing") {
      game.status = "abandoned";
      game.winner = game.players.find(p => p !== playerId);
      return game;
    }
    return null;
  }
  
  deleteGame(gameId) {
    this.games.delete(gameId);
  }
}

module.exports = new GameService();
