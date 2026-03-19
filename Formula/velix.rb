class Velix < Formula
  desc "Multi-provider AI coding assistant with swarm orchestration"
  homepage "https://github.com/cliclye/velix-cli"
  url "https://registry.npmjs.org/velix-cli/-/velix-cli-0.1.0.tgz"
  sha256 "2ac198409f8caf8ef5dcae0c84cc32732e5ec9ca48553df60d7508674e62c6c5"
  license "MIT"

  depends_on "node@18"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "0.1.0", shell_output("#{bin}/velix --version")
  end
end
