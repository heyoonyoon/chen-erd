/**
 * CLI가 사용자에게 한 줄로 알리고 끝내는 오류.
 */
export class CliError extends Error {
  /** 종료 코드. 1 = 실행하다 실패, 2 = 명령을 잘못 적음 */
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}
